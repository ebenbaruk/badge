/**
 * Enclave-side helpers (Node only): they talk to the dstack guest agent through `@phala/dstack-sdk`.
 * Exported from `@badge/attest/server` so browser bundles never pull the SDK in.
 */
import {
  DstackClient,
  type GetKeyResponse,
  type GetQuoteResponse,
  type InfoResponse,
  type TcbInfo,
} from "@phala/dstack-sdk";
import { z } from "zod";
import type { AttestationBundle } from "./bundle";
import { decodeHex, normalizeHex, toHex } from "./bytes";
import { CHANNEL_NONCE_LENGTH, channelReportData, X25519_KEY_LENGTH, x25519PublicKey } from "./channel";
import { AttestError } from "./errors";
import { parseTdxQuote } from "./quote";

/** The subset of `DstackClient` Badge uses (lets tests pass a stub). */
export type DstackAgent = {
  getQuote(reportData: Uint8Array): Promise<Pick<GetQuoteResponse, "quote" | "event_log">>;
  info(): Promise<
    Pick<InfoResponse<TcbInfo>, "app_id" | "compose_hash"> & { tcb_info: Pick<TcbInfo, "app_compose"> }
  >;
  getKey(path: string, purpose?: string): Promise<Pick<GetKeyResponse, "key">>;
};

/** Environment variable the dstack SDK reads to reach the simulator instead of /var/run/dstack.sock. */
export const DSTACK_SIMULATOR_ENDPOINT_ENV = "DSTACK_SIMULATOR_ENDPOINT";

/**
 * Key derivation paths. A path is part of the key identity in the dstack KMS: changing one silently yields a
 * different key and makes previously encrypted data unreadable, so they are fixed here.
 */
export const ENCLAVE_KEY_PATHS = {
  /** Static X25519 key of the attested channel. */
  channel: "badge/channel/x25519",
  /** Data-encryption key of one employee's personal context. */
  employeeDek: (employeeId: string) => `badge/dek/${employeeId}`,
  /** secp256k1 key signing the compliance log head (only this deployment can derive it). */
  auditHead: "badge/audit/head-signer",
} as const;

const DERIVED_KEY_LENGTH = 32;
/** `:` separates an id from a key version (e.g. `badge/dek/alice:2`), see the enclave key rotator. */
const KEY_PATH_PATTERN = /^[a-z0-9][a-z0-9/_.:-]{0,127}$/;

/**
 * Creates a dstack client. In a CVM it uses /var/run/dstack.sock; locally, `DSTACK_SIMULATOR_ENDPOINT`
 * (e.g. http://127.0.0.1:8090, see infra/dstack-sim.sh) or `endpoint` points it at the simulator.
 */
export function createDstackClient(endpoint?: string): DstackClient {
  return new DstackClient(endpoint);
}

function wrap(action: string, error: unknown): AttestError {
  if (error instanceof AttestError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AttestError("DSTACK_FAILED", `dstack ${action} failed: ${message}`, { cause: error });
}

/**
 * Produces the attestation bundle answering a client hello: a quote whose report_data is
 * sha512(nonce || clientPk || enclavePk), the event log and the exact app-compose string.
 *
 * Uses `getQuote` + `info` rather than `attest()`: the 0.5.3 simulator answers "Service not found" to `attest`.
 * @throws AttestError("DSTACK_FAILED") when the guest agent fails, or returns a quote over other report_data.
 */
export async function createAttestationBundle(
  dstack: DstackAgent,
  handshake: { nonce: string; clientPk: string; enclavePk: string },
): Promise<AttestationBundle> {
  const reportData = channelReportData(
    decodeHex(handshake.nonce, "nonce", CHANNEL_NONCE_LENGTH),
    decodeHex(handshake.clientPk, "clientPk", X25519_KEY_LENGTH),
    decodeHex(handshake.enclavePk, "enclavePk", X25519_KEY_LENGTH),
  );
  let quote: Awaited<ReturnType<DstackAgent["getQuote"]>>;
  let info: Awaited<ReturnType<DstackAgent["info"]>>;
  try {
    [quote, info] = await Promise.all([dstack.getQuote(reportData), dstack.info()]);
  } catch (error) {
    throw wrap("getQuote/info", error);
  }
  // Catch a misbehaving agent here rather than letting every client reject the bundle.
  if (parseTdxQuote(quote.quote).reportData !== toHex(reportData)) {
    throw new AttestError("DSTACK_FAILED", "dstack returned a quote over another report_data");
  }
  return {
    quote: normalizeHex(quote.quote),
    eventLog: quote.event_log,
    appCompose: info.tcb_info.app_compose,
    enclavePk: normalizeHex(handshake.enclavePk),
  };
}

/**
 * Derives a 32-byte secret from the dstack KMS. Deterministic per (app, path): the same deployment always gets the
 * same key back after a restart, and no other app can derive it.
 * @throws AttestError("INVALID_INPUT") on a malformed path, AttestError("DSTACK_FAILED") when the agent fails.
 */
export async function deriveEnclaveKey(dstack: DstackAgent, path: string): Promise<Uint8Array> {
  const checkedPath = z.string().regex(KEY_PATH_PATTERN).safeParse(path);
  if (!checkedPath.success) {
    throw new AttestError("INVALID_INPUT", `invalid key path "${path}" (lowercase, digits, / _ . : - only)`);
  }
  let response: Awaited<ReturnType<DstackAgent["getKey"]>>;
  try {
    response = await dstack.getKey(checkedPath.data);
  } catch (error) {
    throw wrap("getKey", error);
  }
  if (response.key.length !== DERIVED_KEY_LENGTH) {
    throw new AttestError(
      "DSTACK_FAILED",
      `getKey returned ${response.key.length} bytes, expected ${DERIVED_KEY_LENGTH}`,
    );
  }
  return response.key;
}

/** Derives the enclave's static X25519 channel key pair (see `EnclaveChannel.accept`). */
export async function deriveChannelKeyPair(
  dstack: DstackAgent,
): Promise<{ secretKey: Uint8Array; publicKey: Uint8Array }> {
  const secretKey = await deriveEnclaveKey(dstack, ENCLAVE_KEY_PATHS.channel);
  return { secretKey, publicKey: x25519PublicKey(secretKey) };
}
