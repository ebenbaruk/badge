/**
 * Captures the values clients pin (`expectedComposeHash`, `expectedAppId`, `expectedOsMeasurements`, and the KMS
 * id `expectedKeyProviderId`) from the TCB info of a fresh deployment, as Phala Cloud reports it
 * (`phala cvms attestation --json`).
 *
 * This is trust on first use by the operator, not a substitute for verifying a quote: the TCB info comes from the
 * platform's API. What it does guarantee is that the pinned values are self-consistent and describe OUR code:
 * the event log replays to the reported RTMRs, the compose hash event is the sha256 of the reported app-compose,
 * that app-compose embeds byte for byte the compose file we deployed, and its confidentiality flags are set.
 * Every client connection then checks these pins against a DCAP-verified quote (`verifyAttestation`, mode `tdx`).
 */
import { z } from "zod";
import { normalizeHex } from "./bytes";
import { composeHashOf, composePolicyViolations, parseAppCompose } from "./compose";
import { AttestError, ComposeError } from "./errors";
import { assertRtmrsMatch, extractAppIdentity, parseEventLog, replayRtmrs } from "./rtmr";
import type { OsMeasurements } from "./verify";

const MEASUREMENT_HEX = /^(0x)?[0-9a-fA-F]{96}$/;
const measurement = (label: string) => z.string().regex(MEASUREMENT_HEX, `${label} must be 48 bytes of hex`);

const tcbInfoSchema = z.looseObject({
  mrtd: measurement("mrtd"),
  rtmr0: measurement("rtmr0"),
  rtmr1: measurement("rtmr1"),
  rtmr2: measurement("rtmr2"),
  rtmr3: measurement("rtmr3"),
  event_log: z.union([z.string(), z.array(z.unknown())]),
  app_compose: z.string().min(1),
});

/** The pins of one deployment, ready to hand to the clients. */
export interface DeploymentPins {
  /** sha256 of the exact app-compose (hex): `expectedComposeHash`, and the `enclaveMeasurement` of consents. */
  composeHash: string;
  /** dstack app id (hex): `expectedAppId`. */
  appId: string;
  /** dstack OS image measurements: `expectedOsMeasurements` (excludes dev images and OS swaps). */
  osMeasurements: OsMeasurements;
  /** KMS identity of the deployment (hex): `expectedKeyProviderId`, when the key-provider event carries one. */
  keyProviderId?: string;
}

const hexOf = (bytes: number, label: string) =>
  z.string().regex(new RegExp(`^(0x)?[0-9a-fA-F]{${bytes * 2}}$`), `${label} must be ${bytes} bytes of hex`);

/**
 * Shape of `infra/cvm/expected-measurements.json` (written by `infra/cvm/pin-measurements.ts`), the file clients
 * load to pin a deployment. Extra fields (e.g. `capturedAt`) are ignored.
 */
export const deploymentPinsSchema = z.object({
  composeHash: hexOf(32, "composeHash"),
  appId: hexOf(20, "appId"),
  osMeasurements: z.object({
    mrtd: measurement("mrtd"),
    rtmr0: measurement("rtmr0"),
    rtmr1: measurement("rtmr1"),
    rtmr2: measurement("rtmr2"),
  }),
  keyProviderId: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]+$/)
    .optional(),
});

/**
 * Validates pins read from a file (JSON already parsed) and normalises their hex.
 * @throws AttestError("INVALID_INPUT") naming the malformed field.
 */
export function parseDeploymentPins(value: unknown): DeploymentPins {
  const parsed = deploymentPinsSchema.safeParse(value);
  if (!parsed.success) {
    throw new AttestError("INVALID_INPUT", `deployment pins are malformed: ${z.prettifyError(parsed.error)}`);
  }
  const pins = parsed.data;
  return {
    composeHash: normalizeHex(pins.composeHash),
    appId: normalizeHex(pins.appId),
    osMeasurements: {
      mrtd: normalizeHex(pins.osMeasurements.mrtd),
      rtmr0: normalizeHex(pins.osMeasurements.rtmr0),
      rtmr1: normalizeHex(pins.osMeasurements.rtmr1),
      rtmr2: normalizeHex(pins.osMeasurements.rtmr2),
    },
    ...(pins.keyProviderId === undefined ? {} : { keyProviderId: normalizeHex(pins.keyProviderId) }),
  };
}

/**
 * Finds the TCB info in a platform response: the object itself, or its `tcb_info` field (an object, or the JSON
 * string the guest agent returns).
 */
function locateTcbInfo(response: unknown): unknown {
  if (typeof response !== "object" || response === null) return response;
  const nested = (response as Record<string, unknown>)["tcb_info"];
  if (nested === undefined) return response;
  if (typeof nested !== "string") return nested;
  try {
    return JSON.parse(nested);
  } catch (error) {
    throw new AttestError("INVALID_INPUT", "tcb_info is a string but not JSON", { cause: error });
  }
}

/**
 * Checks a deployment's TCB info against the compose file that was deployed and returns its pins.
 * @param response TCB info, or a response object carrying it under `tcb_info`.
 * @param deployedDockerCompose The exact content of the compose file given to `phala deploy`.
 * @throws AttestError("INVALID_INPUT"), EventLogError (replay), ComposeError (hash, content or policy mismatch).
 */
export function captureDeploymentPins(response: unknown, deployedDockerCompose: string): DeploymentPins {
  const parsed = tcbInfoSchema.safeParse(locateTcbInfo(response));
  if (!parsed.success) {
    throw new AttestError("INVALID_INPUT", `TCB info is malformed: ${z.prettifyError(parsed.error)}`);
  }
  const tcb = parsed.data;

  const events = parseEventLog(tcb.event_log);
  assertRtmrsMatch(
    replayRtmrs(events),
    [tcb.rtmr0, tcb.rtmr1, tcb.rtmr2, tcb.rtmr3].map((value) => normalizeHex(value)),
  );
  const identity = extractAppIdentity(events);

  const composeHash = composeHashOf(tcb.app_compose);
  if (composeHash !== identity.composeHash) {
    throw new ComposeError(
      "COMPOSE_HASH_MISMATCH",
      "sha256(app_compose) differs from the attested compose hash",
    );
  }
  const appCompose = parseAppCompose(tcb.app_compose);
  if (appCompose["docker_compose_file"] !== deployedDockerCompose) {
    throw new ComposeError(
      "COMPOSE_HASH_MISMATCH",
      "the deployed docker_compose_file is not byte-identical to the local compose file",
    );
  }
  const violations = composePolicyViolations(appCompose);
  if (violations.length > 0) {
    throw new ComposeError("COMPOSE_POLICY_VIOLATION", violations.join("; "));
  }

  return {
    composeHash,
    appId: identity.appId,
    osMeasurements: {
      mrtd: normalizeHex(tcb.mrtd),
      rtmr0: normalizeHex(tcb.rtmr0),
      rtmr1: normalizeHex(tcb.rtmr1),
      rtmr2: normalizeHex(tcb.rtmr2),
    },
    ...(identity.keyProviderId === undefined ? {} : { keyProviderId: identity.keyProviderId }),
  };
}
