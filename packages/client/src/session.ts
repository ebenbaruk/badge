/**
 * Agent sessions: the employee's Ledger signs an `AgentSession` once, delegating *request* rights (never read rights
 * on others' context) to a software key held by the agent. That key then signs every API call.
 */
import { toDeviceAscii, toUnixSeconds, type AgentSession } from "@badge/consent";
import { bytesToBigInt, type Address, type Hex, type LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BadgeApiError } from "./errors";

const HOUR_SECONDS = 3600n;
/** The enclave refuses sessions longer than 12 h (docs/enclave-api.md): the key sits on a laptop. */
export const ENCLAVE_MAX_SESSION_TTL_SECONDS = 12n * HOUR_SECONDS;
/** Default delegation: a working day, comfortably under the cap even with some clock drift. */
export const DEFAULT_AGENT_SESSION_TTL_SECONDS = 8n * HOUR_SECONDS;
/** Access summary shown on the Ledger (ASCII, see the AgentSession descriptor). */
export const DEFAULT_AGENT_ACCESS = "Demander du contexte";
const NONCE_BYTES = 32;

export interface CreateAgentSessionOptions {
  /** Shown on the Ledger ("Agent"); folded to device ASCII. */
  agentName: string;
  /** bytes32 measurement of the attested enclave (`AttestationResult.enclaveMeasurement` or `measurement()`). */
  enclaveMeasurement: Hex;
  /** Shown on the Ledger ("Acces"); folded to device ASCII. */
  access?: string;
  ttlSeconds?: bigint;
  /** Injected for tests. */
  now?: Date;
}

export interface CreatedAgentSession {
  /** The message to sign on the employee's Ledger, then send with `BadgeClient.openSession`. */
  message: AgentSession;
  /** The agent's new key: keep `privateKey` in the agent's own storage, never send it anywhere. */
  sessionKey: LocalAccount;
  privateKey: Hex;
}

function randomNonce(): bigint {
  const bytes = new Uint8Array(NONCE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBigInt(bytes);
}

/**
 * Generates a fresh session key and the `AgentSession` message delegating to it.
 * @throws BadgeApiError("invalid_argument") when the TTL is not positive or exceeds {@link ENCLAVE_MAX_SESSION_TTL_SECONDS}.
 */
export function createAgentSession(
  employee: Address,
  options: CreateAgentSessionOptions,
): CreatedAgentSession {
  const ttl = options.ttlSeconds ?? DEFAULT_AGENT_SESSION_TTL_SECONDS;
  if (ttl <= 0n || ttl > ENCLAVE_MAX_SESSION_TTL_SECONDS) {
    throw new BadgeApiError(
      0,
      "invalid_argument",
      `session TTL must be in (0, ${ENCLAVE_MAX_SESSION_TTL_SECONDS}] seconds, got ${ttl}`,
    );
  }
  const privateKey = generatePrivateKey();
  const sessionKey = privateKeyToAccount(privateKey);
  const message: AgentSession = {
    agentName: toDeviceAscii(options.agentName),
    access: toDeviceAscii(options.access ?? DEFAULT_AGENT_ACCESS),
    expiresAt: toUnixSeconds(options.now ?? new Date()) + ttl,
    sessionKey: sessionKey.address,
    enclaveMeasurement: options.enclaveMeasurement,
    employee,
    nonce: randomNonce(),
  };
  return { message, sessionKey, privateKey };
}
