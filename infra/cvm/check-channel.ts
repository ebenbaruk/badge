/**
 * Opens an attested channel to a deployed enclave and checks one request through it (run by rehearse.sh check):
 *   pnpm exec tsx infra/cvm/check-channel.ts <enclave origin> [simulated | tdx] [expected compose hash]
 * The quote is verified by @badge/client, then the measurement is read again inside the channel and compared with
 * the attested one: proof that the gateway forwards the channel to the enclave that produced the quote.
 * Needs no session (the measurement is a public route), so no Ledger is involved.
 */
import { BadgeClient } from "../../packages/client/src";

const ATTESTATION_MODES = ["simulated", "tdx"] as const;
type AttestationMode = (typeof ATTESTATION_MODES)[number];

function parseMode(value: string | undefined): AttestationMode {
  const mode = value ?? "simulated";
  if (!(ATTESTATION_MODES as readonly string[]).includes(mode)) {
    throw new Error(`attestation mode must be one of ${ATTESTATION_MODES.join(", ")}, got "${mode}"`);
  }
  return mode as AttestationMode;
}

async function main(): Promise<void> {
  const [baseUrl, modeArg, composeHash] = process.argv.slice(2);
  if (baseUrl === undefined) {
    throw new Error("usage: check-channel.ts <enclave origin> [simulated | tdx] [expected compose hash]");
  }
  const attestationMode = parseMode(modeArg);
  if (attestationMode === "tdx" && composeHash === undefined) {
    throw new Error("tdx mode needs the expected compose hash: without a pin any deployment would pass");
  }
  const client = new BadgeClient({
    baseUrl,
    transport: "channel",
    attestationMode,
    ...(composeHash === undefined ? {} : { expectedComposeHash: composeHash }),
  });
  const attestation = await client.connect();
  const inside = await client.measurement();
  if (inside.measurement.toLowerCase() !== attestation.enclaveMeasurement.toLowerCase()) {
    throw new Error(
      `measurement read through the channel (${inside.measurement}) differs from the attested one ` +
        `(${attestation.enclaveMeasurement})`,
    );
  }
  console.log(
    `attested channel: ${attestation.simulated ? "simulated quote" : `TDX quote, TCB ${attestation.tcbStatus}`}, ` +
      `measurement ${attestation.enclaveMeasurement}, round trip OK`,
  );
}

main().catch((error: unknown) => {
  console.error(`check-channel FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
