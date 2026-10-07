/**
 * Clear signing of Badge's EIP-712 messages on Speculos.
 *
 * The Ethereum app only clear-signs an EIP-712 message when it receives *signed filters* (the binary form of an
 * ERC-7730 descriptor) before the message. In production those filters are compiled and signed by Ledger's CAL
 * after the descriptor is merged in the `clear-signing-erc7730-registry`. Here we compile our own
 * {@link ClearSignDescriptor} and sign the filters locally with the PUBLIC TEST CAL key of app-ethereum, plus the
 * Flex test PKI certificate (usage COIN_META) that chains it to Speculos' test PKI root.
 *
 * SPECULOS ONLY, BY DESIGN: a real Ledger (or Speculos with `--pki-prod`) rejects these filters with `6a80`.
 * Running on a real device requires Ledger to sign our ERC-7730 descriptor through the registry.
 *
 * Binary formats mirror app-ethereum's Python client (`eip712/InputData.py`) and the DMK's `getSchemaHash`.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getSchemaHash,
  type TypedDataClearSignContext,
  type TypedDataContext,
  type TypedDataContextLoader,
  type TypedDataFilter,
  type TypedDataSchema,
} from "@ledgerhq/context-module";
import {
  BADGE_DESCRIPTORS,
  BADGE_DOMAIN,
  BADGE_TYPES,
  EIP712_DOMAIN_TYPE,
  type BadgeMessageKind,
  type ClearSignDescriptor,
} from "@badge/consent";
import type { ContactField } from "./contacts";
import { ClearSignSetupError } from "./errors";

/** Env var overriding the path of the app-ethereum test CAL key (PEM). */
export const CAL_TEST_KEY_ENV = "BADGE_CAL_TEST_KEY";
/** Default location, fetched by `infra/setup.sh` and never committed. */
export const DEFAULT_CAL_TEST_KEY_PATH = fileURLToPath(
  new URL("../../../infra/keys/cal-test.pem", import.meta.url),
);

/** Magic bytes of the signed EIP-712 filter payloads (app-ethereum `eip712/InputData.py`). */
export const FILTER_MAGIC = {
  messageInfo: 183,
  datetime: 33,
  raw: 72,
  trustedName: 44,
} as const;

/**
 * Trusted-name filter parameters: accept an "account" name. The sources are those of app-ethereum's own
 * address-book EIP-712 tests; a contact provided with PROVIDE CONTACT is then shown instead of the raw address.
 */
const TRUSTED_NAME_TYPES = [0x01 /* ACCOUNT */] as const;
const TRUSTED_NAME_SOURCES = [0x01 /* CAL */, 0x02 /* ENS */] as const;

/** PKI key usage "COIN_META": the certificate authorises its key to sign coin metadata, EIP-712 filters included. */
const KEY_USAGE_COIN_META = 0x08;

/**
 * Flex TEST PKI certificate (usage COIN_META) carrying the public key of the test CAL key, signed by Speculos'
 * test PKI root. Source: app-ethereum `client/src/ledger_app_clients/ethereum/ledger_pki.py`.
 * The DMK sends it with LOAD_CERTIFICATE before the filters; the app then checks the filters against it instead
 * of the production CAL key compiled in, which is why the release app works without a rebuild.
 */
const FLEX_COIN_META_TEST_CERTIFICATE =
  "01010102010211040000000212010013020002140101160400000000200B45524332305F546F6B656E3002000631010832012133" +
  "21024CCA8FAD496AA5040A00A7EB2F5CC3B85376D88BA147A7D7054A99C64056188734010135010515473045022100B59EA8B958" +
  "AA40578A6FBE9BBFB761020ACD5DBD8AA863C11DA17F42B2AFDE790220186316059EFA58811337D47C7F815F772EA42BBBCEA4AE" +
  "123D1118C80588F5CB";

const UINT64_BYTES = 8;
const ADDRESS_BYTES = 20;
const SCHEMA_HASH_BYTES = 28;
/** The filters count is sent as one byte. */
const MAX_FILTERS = 255;
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/** Signs a filter payload and returns the DER signature as hex (what the DMK forwards to the device). */
export type FilterSigner = (payload: Uint8Array) => string;

/** Domain and schema a set of filters is bound to. */
export interface FilterBinding {
  chainId: number;
  verifyingContract: string;
  /** SHA-224 of the schema, hex (see `getSchemaHash`). */
  schemaHash: string;
}

/** Common prefix of every filter payload: magic, chain id, verifying contract, schema hash. */
function filterPrefix(magic: number, binding: FilterBinding): Buffer {
  const chainId = Buffer.alloc(UINT64_BYTES);
  chainId.writeBigUInt64BE(BigInt(binding.chainId));
  const contract = Buffer.from(binding.verifyingContract.replace(/^0x/i, ""), "hex");
  const schemaHash = Buffer.from(binding.schemaHash, "hex");
  if (contract.length !== ADDRESS_BYTES) throw new ClearSignSetupError("verifyingContract must be 20 bytes");
  if (schemaHash.length !== SCHEMA_HASH_BYTES) throw new ClearSignSetupError("schemaHash must be 28 bytes");
  return Buffer.concat([Buffer.from([magic]), chainId, contract, schemaHash]);
}

/** Payload signed for the message header: what the device shows under "Contract", and how many filters follow. */
export function messageInfoPayload(
  binding: FilterBinding,
  displayName: string,
  filtersCount: number,
): Buffer {
  if (!Number.isInteger(filtersCount) || filtersCount < 0 || filtersCount > MAX_FILTERS) {
    throw new ClearSignSetupError(`filtersCount must be an integer in [0, ${MAX_FILTERS}]`);
  }
  return Buffer.concat([
    filterPrefix(FILTER_MAGIC.messageInfo, binding),
    Buffer.from([filtersCount]),
    Buffer.from(displayName, "ascii"),
  ]);
}

/** Payload signed for one displayed field: its path in the message and its label. */
export function fieldFilterPayload(
  binding: FilterBinding,
  field: ClearSignDescriptor["fields"][number],
): Buffer {
  return Buffer.concat([
    filterPrefix(FILTER_MAGIC[field.format], binding),
    Buffer.from(field.path, "ascii"),
    Buffer.from(field.label, "ascii"),
  ]);
}

/**
 * Payload signed for an address field displayed through the device address book (trusted-name filter):
 * path, label, accepted name types, accepted name sources.
 */
export function contactFilterPayload(binding: FilterBinding, field: ContactField): Buffer {
  return Buffer.concat([
    filterPrefix(FILTER_MAGIC.trustedName, binding),
    Buffer.from(field.path, "ascii"),
    Buffer.from(field.label, "ascii"),
    Buffer.from(TRUSTED_NAME_TYPES),
    Buffer.from(TRUSTED_NAME_SOURCES),
  ]);
}

/** Types and sources as the DMK forwards them in the filter APDU: count-prefixed byte lists. */
const TRUSTED_NAME_TYPES_AND_SOURCES = Buffer.from([
  TRUSTED_NAME_TYPES.length,
  ...TRUSTED_NAME_TYPES,
  TRUSTED_NAME_SOURCES.length,
  ...TRUSTED_NAME_SOURCES,
]).toString("hex");

function assertDeviceLabel(value: string, what: string): void {
  if (!PRINTABLE_ASCII.test(value))
    throw new ClearSignSetupError(`${what} must be non-empty printable ASCII`);
}

/**
 * Compiles a descriptor into the signed clear-signing context the DMK expects from a typed-data loader.
 * Fields absent from the descriptor are still signed by the device, just not displayed.
 * @param contactField - optional address field displayed through the device address book.
 */
export function compileClearSignContext(
  descriptor: ClearSignDescriptor,
  binding: FilterBinding,
  signFilter: FilterSigner,
  contactField?: ContactField,
): TypedDataClearSignContext {
  assertDeviceLabel(descriptor.intent, "Descriptor intent");
  const filters: Record<string, TypedDataFilter> = {};
  for (const field of descriptor.fields) {
    assertDeviceLabel(field.label, `Label of ${field.path}`);
    filters[field.path] = {
      type: field.format,
      displayName: field.label,
      path: field.path,
      signature: signFilter(fieldFilterPayload(binding, field)),
    };
  }
  if (contactField !== undefined) {
    assertDeviceLabel(contactField.label, `Label of ${contactField.path}`);
    filters[contactField.path] = {
      type: "trusted-name",
      displayName: contactField.label,
      path: contactField.path,
      // Informative only: the device reads typesAndSourcesPayload, which is what the signature covers.
      types: ["eoa"],
      sources: ["cal", "ens"],
      typesAndSourcesPayload: TRUSTED_NAME_TYPES_AND_SOURCES,
      signature: signFilter(contactFilterPayload(binding, contactField)),
    };
  }
  const filtersCount = Object.keys(filters).length;
  return {
    type: "success",
    messageInfo: {
      displayName: descriptor.intent,
      filtersCount,
      signature: signFilter(messageInfoPayload(binding, descriptor.intent, filtersCount)),
    },
    filters,
    trustedNamesAddresses: {},
    tokens: {},
    calldatas: {},
    certificate: {
      keyUsageNumber: KEY_USAGE_COIN_META,
      payload: Buffer.from(FLEX_COIN_META_TEST_CERTIFICATE, "hex"),
    },
  };
}

/** Schema the DMK sends for a Badge message kind: the primary struct plus `EIP712Domain`. */
export function badgeSchema(kind: BadgeMessageKind): TypedDataSchema {
  return {
    EIP712Domain: EIP712_DOMAIN_TYPE.map(({ name, type }) => ({ name, type })),
    [kind]: BADGE_TYPES[kind].map(({ name, type }) => ({ name, type })),
  };
}

/** Schema hash (SHA-224, hex) of a Badge message kind, as computed by the DMK and the device. */
export function badgeSchemaHash(kind: BadgeMessageKind): string {
  return getSchemaHash(badgeSchema(kind));
}

/**
 * Loads the test CAL private key and returns a {@link FilterSigner} (ECDSA secp256k1 over SHA-256, DER).
 * @param pemPath - defaults to `$BADGE_CAL_TEST_KEY`, then `infra/keys/cal-test.pem` at the repository root.
 * @throws ClearSignSetupError when the file is missing or holds no EC private key.
 */
export function loadCalTestSigner(pemPath: string = resolveCalTestKeyPath()): FilterSigner {
  let pem: string;
  try {
    pem = readFileSync(pemPath, "utf8");
  } catch (error) {
    throw new ClearSignSetupError(
      `Test CAL key not found at ${pemPath}: run infra/setup.sh or set ${CAL_TEST_KEY_ENV}`,
      { cause: error },
    );
  }
  // The upstream file also holds an "EC PARAMETERS" block that createPrivateKey refuses; keep the key block only.
  const keyBlock = /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/.exec(pem)?.[0];
  if (keyBlock === undefined) throw new ClearSignSetupError(`No EC private key in ${pemPath}`);
  let key: KeyObject;
  try {
    key = createPrivateKey(keyBlock);
  } catch (error) {
    throw new ClearSignSetupError(`Unreadable EC private key in ${pemPath}`, { cause: error });
  }
  return (payload) => sign("sha256", payload, { key, dsaEncoding: "der" }).toString("hex");
}

/** Path of the test CAL key: `$BADGE_CAL_TEST_KEY` or the repository default. */
export function resolveCalTestKeyPath(): string {
  const fromEnv = process.env[CAL_TEST_KEY_ENV];
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : DEFAULT_CAL_TEST_KEY_PATH;
}

const SCHEMA_HASH_TO_KIND: ReadonlyMap<string, BadgeMessageKind> = new Map(
  (Object.keys(BADGE_TYPES) as BadgeMessageKind[]).map((kind) => [badgeSchemaHash(kind), kind]),
);

/**
 * DMK typed-data loader serving Badge's clear-signing filters (replaces the default loader that queries Ledger's
 * CAL). It fails closed: a message that is not exactly a Badge struct under the Badge domain gets an error, so
 * our test-signed filters are never attached to anything else.
 */
export class BadgeClearSignLoader implements TypedDataContextLoader {
  /**
   * @param contactFields - address fields rendered through the device address book (see SUGGESTED_CONTACT_FIELDS).
   * @throws ClearSignSetupError if a contact field is not a hidden address field of its message.
   */
  constructor(
    private readonly signFilter: FilterSigner,
    private readonly contactFields: Partial<Record<BadgeMessageKind, ContactField>> = {},
  ) {
    for (const [kind, field] of Object.entries(contactFields) as [BadgeMessageKind, ContactField][]) {
      const type = BADGE_TYPES[kind].find((candidate) => candidate.name === field.path)?.type;
      if (type !== "address") throw new ClearSignSetupError(`${kind}.${field.path} is not an address field`);
      if (BADGE_DESCRIPTORS[kind].fields.some((displayed) => displayed.path === field.path)) {
        throw new ClearSignSetupError(`${kind}.${field.path} already has a display filter`);
      }
    }
  }

  async load(context: TypedDataContext): Promise<TypedDataClearSignContext> {
    const schemaHash = getSchemaHash(context.schema);
    const kind = SCHEMA_HASH_TO_KIND.get(schemaHash);
    if (kind === undefined) return loaderError("schema is not a Badge message");
    if (context.chainId !== BADGE_DOMAIN.chainId) return loaderError(`unexpected chainId ${context.chainId}`);
    if (context.verifyingContract.toLowerCase() !== BADGE_DOMAIN.verifyingContract.toLowerCase()) {
      return loaderError(`unexpected verifyingContract ${context.verifyingContract}`);
    }
    // No check on context.deviceModelId: the Speculos transport reports "stax" whatever the emulated model, so
    // the bundled (Flex) certificate is always sent. Our Speculos devices are Flex (infra/speculos.sh).
    const binding = { chainId: context.chainId, verifyingContract: context.verifyingContract, schemaHash };
    return compileClearSignContext(
      BADGE_DESCRIPTORS[kind],
      binding,
      this.signFilter,
      this.contactFields[kind],
    );
  }
}

function loaderError(reason: string): TypedDataClearSignContext {
  return { type: "error", error: new ClearSignSetupError(`Badge clear signing refused: ${reason}`) };
}
