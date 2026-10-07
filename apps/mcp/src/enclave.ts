/**
 * Connection to the enclave for one employee: a BadgeClient signing with the session key, over the attested
 * channel, with the attestation checked before the MCP server starts.
 */
import { BadgeApiError, BadgeClient, type FetchLike } from "@badge/client";
import type { LocalAccount } from "viem";
import type { EnclaveConfig } from "./config";
import { McpSetupError } from "./errors";
import type { UsableSession } from "./session-file";

export interface ConnectOptions {
  /** Injected in tests. */
  readonly fetch?: FetchLike;
  /** Where non-fatal warnings go (stderr in production: stdout belongs to the MCP stdio protocol). */
  readonly warn: (message: string) => void;
}

/**
 * A client for the configured enclave. Without `sessionKey` it can only use the Ledger-signed public routes
 * (opening a session); `connect()` attests the enclave in channel mode.
 */
export function createEnclaveClient(
  config: EnclaveConfig,
  sessionKey?: LocalAccount,
  fetch?: FetchLike,
): BadgeClient {
  return new BadgeClient({
    baseUrl: config.enclaveUrl,
    transport: config.enclaveTransport,
    attestationMode: config.attestationMode,
    ...(sessionKey === undefined ? {} : { sessionKey }),
    ...config.pins,
    ...(fetch === undefined ? {} : { fetch }),
  });
}

/**
 * Verifies the enclave before the MCP server starts (channel transport).
 *
 * - `tdx`: any failure (unreachable, untrusted quote) refuses to start: the agent must never talk to an
 *   unverified enclave, and a server that starts "degraded" would hide that from the employee.
 * - `simulated`: an unreachable enclave is only a warning (the channel attests again on the first call, and an
 *   enclave that does not know the session answers SESSION_UNKNOWN), but a rejected attestation still refuses.
 * - In both modes the attested measurement must be the one the employee signed in the AgentSession.
 *
 * @throws McpSetupError (`ATTESTATION_FAILED`, `MEASUREMENT_MISMATCH`).
 */
export async function verifyEnclave(
  client: Pick<BadgeClient, "connect">,
  config: EnclaveConfig,
  session: UsableSession,
  warn: (message: string) => void,
): Promise<void> {
  if (config.enclaveTransport === "plain") {
    warn("plain HTTP transport: the enclave is NOT attested (local development only)");
    return;
  }
  let measurement: string;
  try {
    measurement = (await client.connect()).enclaveMeasurement;
  } catch (error) {
    const rejected = error instanceof BadgeApiError && error.code === "ATTESTATION_FAILED";
    const reason = error instanceof Error ? error.message : String(error);
    if (config.attestationMode === "tdx" || rejected) {
      throw new McpSetupError("ATTESTATION_FAILED", `enclave attestation failed: ${reason}`, {
        cause: error,
      });
    }
    warn(`enclave unreachable, will attest on the first call: ${reason}`);
    return;
  }
  if (measurement.toLowerCase() !== session.message.enclaveMeasurement.toLowerCase()) {
    throw new McpSetupError(
      "MEASUREMENT_MISMATCH",
      `the enclave measures ${measurement} but the session was signed for ${session.message.enclaveMeasurement}: ` +
        "create and sign a new session for this enclave",
    );
  }
}

/**
 * Creates the employee's client (signing with the session key) and verifies the enclave ({@link verifyEnclave}).
 * @throws McpSetupError (`ATTESTATION_FAILED`, `MEASUREMENT_MISMATCH`).
 */
export async function connectEnclave(
  config: EnclaveConfig,
  session: UsableSession,
  options: ConnectOptions,
): Promise<BadgeClient> {
  const client = createEnclaveClient(config, session.account, options.fetch);
  await verifyEnclave(client, config, session, options.warn);
  return client;
}
