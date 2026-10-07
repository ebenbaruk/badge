/**
 * Opens an attested channel to a deployed enclave and checks one request through it (run by rehearse.sh check):
 *   pnpm exec tsx infra/cvm/check-channel.ts <enclave origin> [simulated | tdx] [pins file]
 * In tdx mode the pins (compose hash, app id, OS measurements, KMS id) come from the pins file, by default
 * infra/cvm/expected-measurements.json as written by pin-measurements.ts.
 * The quote is verified by @badge/client, then the measurement is read again inside the channel and compared with
 * the attested one: proof that the gateway forwards the channel to the enclave that produced the quote.
 * Needs no session (the measurement is a public route), so no Ledger is involved.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BadgeClient, enclavePinsFromEnv } from "../../packages/client/src";

const DEFAULT_PINS_FILE = join(dirname(fileURLToPath(import.meta.url)), "expected-measurements.json");

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
  const [baseUrl, modeArg, pinsFile] = process.argv.slice(2);
  if (baseUrl === undefined) {
    throw new Error("usage: check-channel.ts <enclave origin> [simulated | tdx] [pins file]");
  }
  const attestationMode = parseMode(modeArg);
  // Without pins any deployment would pass: tdx always reads them (and fails if one is missing).
  const pins =
    attestationMode === "tdx"
      ? enclavePinsFromEnv(
          { BADGE_ENCLAVE_OS_MEASUREMENTS_FILE: pinsFile ?? DEFAULT_PINS_FILE },
          "tdx",
          (path) => readFileSync(path, "utf8"),
        )
      : {};
  const client = new BadgeClient({ baseUrl, transport: "channel", attestationMode, ...pins });
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
