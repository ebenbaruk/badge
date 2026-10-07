/**
 * Records the pins of a fresh deployment for the clients (run by infra/phala-up.sh):
 *   pnpm exec tsx infra/cvm/pin-measurements.ts <attestation.json>
 * where attestation.json is the output of `phala cvms attestation <app> --json`. Writes, next to this file:
 *  - expected-compose-hash.txt: the client's `expectedComposeHash` (hex, one line);
 *  - expected-measurements.json: compose hash, app id and dstack OS measurements (`expectedOsMeasurements`).
 * Fails (exit 1, nothing written) unless the deployment is exactly infra/cvm/compose.yml with its confidentiality
 * flags set (see captureDeploymentPins).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDeploymentPins } from "../../packages/attest/src";

const CVM_DIR = dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = join(CVM_DIR, "compose.yml");
const COMPOSE_HASH_FILE = join(CVM_DIR, "expected-compose-hash.txt");
const MEASUREMENTS_FILE = join(CVM_DIR, "expected-measurements.json");

function main(): void {
  const attestationFile = process.argv[2];
  if (!attestationFile) throw new Error("usage: pin-measurements.ts <phala cvms attestation --json output>");
  const response: unknown = JSON.parse(readFileSync(attestationFile, "utf8"));
  const pins = captureDeploymentPins(response, readFileSync(COMPOSE_FILE, "utf8"));
  writeFileSync(COMPOSE_HASH_FILE, `${pins.composeHash}\n`);
  writeFileSync(
    MEASUREMENTS_FILE,
    `${JSON.stringify({ capturedAt: new Date().toISOString(), ...pins }, null, 2)}\n`,
  );
  console.log(`compose hash ${pins.composeHash}`);
  console.log(`app id       ${pins.appId}`);
  console.log(`written: ${COMPOSE_HASH_FILE}, ${MEASUREMENTS_FILE}`);
}

try {
  main();
} catch (error) {
  console.error(`pin-measurements FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
