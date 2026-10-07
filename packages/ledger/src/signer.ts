/**
 * Ledger signer for Badge, on top of the Device Management Kit and the Speculos transport.
 */
import { ContextModuleBuilder, ContextModuleChainID } from "@ledgerhq/context-module";
import {
  DeviceManagementKitBuilder,
  type DeviceManagementKit,
  type DeviceSessionId,
} from "@ledgerhq/device-management-kit";
import { SignerEthBuilder, type SignerEth } from "@ledgerhq/device-signer-kit-ethereum";
import { speculosTransportFactory } from "@ledgerhq/device-transport-kit-speculos";
import { firstValueFrom, timeout } from "rxjs";
import {
  getAddress as checksumAddress,
  isAddressEqual,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import type { BadgeMessageKind, BadgeMessages } from "@badge/consent";
import { BadgeClearSignLoader, loadCalTestSigner, type FilterSigner } from "./clearSign";
import { runDeviceAction, type DeviceActionOptions } from "./deviceAction";
import { LedgerConnectionError, NonAsciiFieldError, SignatureMismatchError } from "./errors";
import { assertStringFieldsAscii, badgeTypedData, toDmkTypedData, toViemTypedData } from "./typedData";

/** First Ethereum account (BIP-44). Every Badge identity is bound to it. */
export const BADGE_DERIVATION_PATH = "44'/60'/0'/0/0";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const SIGNATURE_COMPONENT_HEX_LENGTH = 64;
/** Legacy `v` offset: some app versions return the recovery id (0/1) instead of 27/28. */
const LEGACY_V_OFFSET = 27;
/** Personal messages may span several lines; everything else must be printable ASCII (what the device renders). */
const PERSONAL_MESSAGE_ASCII = /^[\x20-\x7E\n]+$/;

export interface LedgerSignerOptions {
  /** Path of the test CAL key; defaults to `$BADGE_CAL_TEST_KEY` then `infra/keys/cal-test.pem`. */
  calTestKeyPath?: string;
  /** Overrides the filter signer (tests). Takes precedence over `calTestKeyPath`. */
  signFilter?: FilterSigner;
  /** Maximum time to discover and open the Speculos session. */
  connectTimeoutMs?: number;
}

/** Options of a signing call: progress (to drive or display the device) and cancellation. */
export type SignOptions = DeviceActionOptions;

interface RawSignature {
  r: string;
  s: string;
  v: number;
}

/** Serialises a DMK `{r, s, v}` into a 65-byte `r || s || v` hex signature (viem / ethers format). */
export function toSignatureHex({ r, s, v }: RawSignature): Hex {
  const pad = (component: string): string =>
    component.replace(/^0x/i, "").padStart(SIGNATURE_COMPONENT_HEX_LENGTH, "0");
  const normalizedV = v < LEGACY_V_OFFSET ? v + LEGACY_V_OFFSET : v;
  return `0x${pad(r)}${pad(s)}${normalizedV.toString(16).padStart(2, "0")}`;
}

/**
 * One employee's Ledger (a Speculos Flex in the demo).
 *
 * Every signature is verified locally against the device address before being returned (fail closed): a wrong
 * payload, a wrong account or a serialisation bug surfaces here and not later in the enclave.
 * Device actions are serialised: the device can only show one review at a time.
 */
export class LedgerSigner {
  private address: Address | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly speculosUrl: string,
    private readonly dmk: DeviceManagementKit,
    private readonly sessionId: DeviceSessionId,
    private readonly eth: SignerEth,
  ) {}

  /**
   * Opens a DMK session on a Speculos instance.
   * @param speculosUrl - Speculos API root, e.g. `http://localhost:5001`.
   * @throws LedgerConnectionError when Speculos cannot be reached in time.
   * @throws ClearSignSetupError when the test CAL key cannot be loaded.
   */
  static async connect(speculosUrl: string, options: LedgerSignerOptions = {}): Promise<LedgerSigner> {
    const url = z
      .url({ protocol: /^https?$/ })
      .parse(speculosUrl)
      .replace(/\/+$/, "");
    // Load the key first: a missing key is a setup error, better reported before touching the device.
    const signFilter = options.signFilter ?? loadCalTestSigner(options.calTestKeyPath);
    const dmk = new DeviceManagementKitBuilder().addTransport(speculosTransportFactory(url)).build();
    try {
      const device = await firstValueFrom(
        dmk.startDiscovering({}).pipe(timeout(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)),
      );
      await dmk.stopDiscovering();
      const sessionId = await dmk.connect({ device });
      const contextModule = new ContextModuleBuilder({})
        // Mandatory: build() throws "setChain() must be called before build()" otherwise (undocumented).
        .setChain(ContextModuleChainID.Ethereum)
        .addTypedDataLoader(new BadgeClearSignLoader(signFilter))
        .build();
      const eth = new SignerEthBuilder({ dmk, sessionId }).withContextModule(contextModule).build();
      return new LedgerSigner(url, dmk, sessionId, eth);
    } catch (error) {
      dmk.close();
      throw new LedgerConnectionError(`Cannot open a Ledger session on Speculos at ${url}`, { cause: error });
    }
  }

  /** Address of {@link BADGE_DERIVATION_PATH}, checksummed. Cached after the first call. */
  async getAddress(options: SignOptions = {}): Promise<Address> {
    if (this.address !== undefined) return this.address;
    const result = await this.exclusive(() =>
      runDeviceAction("getAddress", () => this.eth.getAddress(BADGE_DERIVATION_PATH), options),
    );
    this.address = checksumAddress(result.address);
    return this.address;
  }

  /**
   * Clear-signs a Badge EIP-712 message. The device shows the descriptor labels of `kind` (see
   * `BADGE_DESCRIPTORS`) and waits for the user to hold "Hold to sign".
   * @returns the 65-byte signature, verified to recover the device address.
   * @throws NonAsciiFieldError if a string field is not printable ASCII.
   * @throws UserRejectedError when refused on the device; DeviceActionError for other device errors.
   */
  async signBadgeMessage<K extends BadgeMessageKind>(
    kind: K,
    message: BadgeMessages[K],
    options: SignOptions = {},
  ): Promise<Hex> {
    assertStringFieldsAscii(kind, message);
    const address = await this.getAddress();
    const typedData = badgeTypedData(kind, message);
    const raw = await this.exclusive(() =>
      runDeviceAction(
        `signTypedData(${kind})`,
        () => this.eth.signTypedData(BADGE_DERIVATION_PATH, toDmkTypedData(typedData)),
        options,
      ),
    );
    const signature = toSignatureHex(raw);
    const signer = await recoverTypedDataAddress({ ...toViemTypedData(typedData), signature });
    this.assertSignedBy(signer, address, `${kind} signature`);
    return signature;
  }

  /**
   * Signs an EIP-191 personal message (shown verbatim on the device), e.g. `deskIdentityDeriveMessage`.
   * @returns the 65-byte signature, verified to recover the device address.
   */
  async signPersonalMessage(text: string, options: SignOptions = {}): Promise<Hex> {
    if (!PERSONAL_MESSAGE_ASCII.test(text)) throw new NonAsciiFieldError("personal message");
    const address = await this.getAddress();
    const raw = await this.exclusive(() =>
      runDeviceAction("signMessage", () => this.eth.signMessage(BADGE_DERIVATION_PATH, text), options),
    );
    const signature = toSignatureHex(raw);
    const signer = await recoverMessageAddress({ message: text, signature });
    this.assertSignedBy(signer, address, "personal message signature");
    return signature;
  }

  /** Closes the DMK session and releases the transport. */
  async close(): Promise<void> {
    try {
      await this.dmk.disconnect({ sessionId: this.sessionId });
    } finally {
      this.dmk.close();
    }
  }

  private assertSignedBy(recovered: Address, expected: Address, what: string): void {
    if (!isAddressEqual(recovered, expected)) {
      throw new SignatureMismatchError(`${what} recovers ${recovered}, expected device address ${expected}`);
    }
  }

  /** Runs `task` after every previously queued device action, whatever their outcome. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    // The caller receives the outcome through `run`; the queue itself must never reject, or it would block.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
