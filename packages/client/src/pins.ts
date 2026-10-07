/**
 * What a client pins about the enclave it talks to, and how the web app, the MCP server and the scripts read those
 * pins from their environment. In `tdx` mode the compose hash, the app id and the dstack OS measurements are all
 * mandatory: the same compose deployed on a dev OS image (root access to the guest) or under another app id / KMS
 * would otherwise pass attestation and receive the channel key.
 */
import { parseDeploymentPins, type AttestationMode, type OsMeasurements } from "@badge/attest";
import { BadgeApiError } from "./errors";

/** Values checked against every attested quote (`verifyAttestation`), hex without prefix. */
export interface EnclavePins {
  /** Pinned compose hash; mandatory with `attestationMode: "tdx"`. */
  expectedComposeHash?: string;
  /** Pinned dstack app id; mandatory with `attestationMode: "tdx"`. */
  expectedAppId?: string;
  /** Pinned dstack OS image (MRTD, RTMR0-2); mandatory with `attestationMode: "tdx"`. */
  expectedOsMeasurements?: OsMeasurements;
  /** Pinned KMS identity, checked when given. */
  expectedKeyProviderId?: string;
}

/** Environment variables read by {@link enclavePinsFromEnv}. */
export const ENCLAVE_PIN_ENV = {
  composeHash: "BADGE_ENCLAVE_COMPOSE_HASH",
  appId: "BADGE_ENCLAVE_APP_ID",
  /** Path of `infra/cvm/expected-measurements.json` (written by `infra/cvm/pin-measurements.ts`). */
  measurementsFile: "BADGE_ENCLAVE_OS_MEASUREMENTS_FILE",
} as const;

const COMPOSE_HASH_HEX = /^(0x)?[0-9a-fA-F]{64}$/;
const APP_ID_HEX = /^(0x)?[0-9a-fA-F]{40}$/;

const invalid = (message: string, cause?: unknown) =>
  new BadgeApiError(0, "INVALID_ARGUMENT", message, cause === undefined ? undefined : { cause });

function hexVar(env: Readonly<Record<string, string | undefined>>, name: string, pattern: RegExp) {
  const value = env[name];
  if (value === undefined || value === "") return undefined;
  if (!pattern.test(value)) throw invalid(`${name} is not valid hex of the expected length`);
  return value.replace(/^0x/, "").toLowerCase();
}

/**
 * Reads the enclave pins: `BADGE_ENCLAVE_COMPOSE_HASH`, `BADGE_ENCLAVE_APP_ID` and the pins file named by
 * `BADGE_ENCLAVE_OS_MEASUREMENTS_FILE` (which also carries the compose hash, app id and KMS id; a value given both
 * ways must agree). Fails closed in `tdx` mode when the compose hash, app id or OS measurements are missing.
 * @param readFile reads a UTF-8 file (injected: this package stays browser-safe).
 * @throws BadgeApiError("INVALID_ARGUMENT") naming the variable at fault.
 */
export function enclavePinsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  mode: AttestationMode,
  readFile: (path: string) => string,
): EnclavePins {
  let composeHash = hexVar(env, ENCLAVE_PIN_ENV.composeHash, COMPOSE_HASH_HEX);
  let appId = hexVar(env, ENCLAVE_PIN_ENV.appId, APP_ID_HEX);
  const pins: EnclavePins = {};
  const file = env[ENCLAVE_PIN_ENV.measurementsFile];
  if (file !== undefined && file !== "") {
    let fromFile;
    try {
      fromFile = parseDeploymentPins(JSON.parse(readFile(file)));
    } catch (error) {
      throw invalid(`${ENCLAVE_PIN_ENV.measurementsFile}: cannot read pins from ${file}`, error);
    }
    if (composeHash !== undefined && composeHash !== fromFile.composeHash) {
      throw invalid(`${ENCLAVE_PIN_ENV.composeHash} differs from the compose hash in ${file}`);
    }
    if (appId !== undefined && appId !== fromFile.appId) {
      throw invalid(`${ENCLAVE_PIN_ENV.appId} differs from the app id in ${file}`);
    }
    composeHash = fromFile.composeHash;
    appId = fromFile.appId;
    pins.expectedOsMeasurements = fromFile.osMeasurements;
    if (fromFile.keyProviderId !== undefined) pins.expectedKeyProviderId = fromFile.keyProviderId;
  }
  if (composeHash !== undefined) pins.expectedComposeHash = composeHash;
  if (appId !== undefined) pins.expectedAppId = appId;
  if (mode === "tdx") assertTdxPins(pins);
  return pins;
}

/**
 * Fails closed when a `tdx` client lacks one of the mandatory pins.
 * @throws BadgeApiError("INVALID_ARGUMENT") listing what is missing.
 */
export function assertTdxPins(pins: EnclavePins): void {
  const missing = [
    pins.expectedComposeHash === undefined ? ENCLAVE_PIN_ENV.composeHash : undefined,
    pins.expectedAppId === undefined ? ENCLAVE_PIN_ENV.appId : undefined,
    pins.expectedOsMeasurements === undefined ? ENCLAVE_PIN_ENV.measurementsFile : undefined,
  ].filter((name) => name !== undefined);
  if (missing.length > 0) {
    throw invalid(
      `tdx attestation needs the enclave pins (compose hash, app id, OS measurements); missing: ${missing.join(", ")}`,
    );
  }
}

/** Only the pins that are set (for `exactOptionalPropertyTypes` spreads). */
export function definedPins(pins: EnclavePins): EnclavePins {
  return Object.fromEntries(Object.entries(pins).filter(([, value]) => value !== undefined)) as EnclavePins;
}
