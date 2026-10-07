import { z } from "zod";
import { decodeHex, normalizeHex, toHex } from "./bytes";
import {
  CHANNEL_NONCE_LENGTH,
  channelReportData,
  X25519_KEY_LENGTH,
  type ChannelAttestation,
} from "./channel";
import { composeHashOf, composePolicyViolations, enclaveMeasurementFrom, parseAppCompose } from "./compose";
import { AttestationError, AttestError, ComposeError, EventLogError, type AttestErrorCode } from "./errors";
import { parseTdxQuote, type TdxQuote } from "./quote";
import { assertRtmrsMatch, extractAppIdentity, parseEventLog, replayRtmrs } from "./rtmr";

/**
 * `tdx`: real Intel TDX evidence, every check is mandatory (fail closed).
 * `simulated`: the dstack simulator, whose quote is a fixed file with a broken signature. DCAP is skipped and
 * platform checks become warnings; the result says `simulated: true` so the UI can show it is NOT a real TEE.
 */
export type AttestationMode = "tdx" | "simulated";

/** TCB statuses reported by Intel DCAP, plus `Simulated` when no DCAP check was run. */
export type TcbStatus =
  | "UpToDate"
  | "SWHardeningNeeded"
  | "ConfigurationNeeded"
  | "ConfigurationAndSWHardeningNeeded"
  | "OutOfDate"
  | "OutOfDateConfigurationNeeded"
  | "Revoked"
  | "Unknown"
  | "Simulated";

/** Only a fully patched platform is accepted: any other status means known, unmitigated TEE vulnerabilities. */
const ACCEPTED_TCB_STATUS = "UpToDate" satisfies TcbStatus;
const COMPOSE_HASH_LENGTH = 32;
const APP_ID_LENGTH = 20;
const MEASUREMENT_LENGTH = 48;

/** Outcome of the Intel DCAP verification of a quote (signature chain + TCB level). */
export interface DcapReport {
  status: string;
  advisoryIds: string[];
  /** RTMR3 and report_data read by the DCAP library, cross-checked against our own parser. */
  rtmr3: string;
  reportData: string;
}

/** Verifies a quote's Intel signature chain and TCB status; must throw when the quote is not authentic. */
export type DcapVerifier = (quote: Uint8Array) => Promise<DcapReport>;

/** Expected dstack OS measurements (MRTD + RTMR0-2), e.g. captured once from the production CVM. */
export interface OsMeasurements {
  mrtd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
}

export interface VerifyAttestationInput {
  /** Quote returned by the enclave (hex). */
  quote: string;
  /** dstack event log returned with the quote (JSON string or parsed array). */
  eventLog: string | unknown[];
  /** The exact app-compose string of the deployment (`info().tcb_info.app_compose`). */
  appCompose: string;
  /** The client's own handshake values (never take them from the enclave's response). */
  nonce: string;
  clientPk: string;
  /** The enclave's X25519 public key, as returned with the quote. */
  enclavePk: string;
  /** Compose hash the client trusts (hard-coded or configured). Mandatory in `tdx` mode. */
  expectedComposeHash?: string;
  /** dstack app id the client trusts. */
  expectedAppId?: string;
  /** Pins the dstack OS image (excludes dev images, which have other measurements). */
  expectedOsMeasurements?: OsMeasurements;
  mode: AttestationMode;
  /** Overrides the DCAP verifier (defaults to `@phala/dcap-qvl` with Phala's PCCS). */
  dcapVerifier?: DcapVerifier;
}

/** A successful verification. Pass it to `ClientChannel.establish`. */
export interface VerifiedAttestation extends ChannelAttestation {
  ok: true;
  mode: AttestationMode;
  simulated: boolean;
  tcbStatus: TcbStatus;
  advisoryIds: string[];
  /** Attested compose hash (hex, from RTMR3). */
  composeHash: string;
  /** `composeHash` as the bytes32 used in Badge EIP-712 messages. */
  enclaveMeasurement: `0x${string}`;
  appId: string;
  rtmr3: string;
  keyProvider: string | undefined;
  /** Checks that were relaxed (simulated mode) or advisories worth showing. */
  warnings: string[];
}

/** A failed verification: never talk to this enclave. */
export interface RejectedAttestation {
  ok: false;
  mode: AttestationMode;
  simulated: boolean;
  code: AttestErrorCode;
  reason: string;
}

export type AttestationResult = VerifiedAttestation | RejectedAttestation;

const hex = (bytes: number, label: string) =>
  z.string().regex(new RegExp(`^(0x)?[0-9a-fA-F]{${bytes * 2}}$`), `${label} must be ${bytes} bytes of hex`);

const inputSchema = z
  .object({
    quote: z.string().min(1),
    eventLog: z.union([z.string(), z.array(z.unknown())]),
    appCompose: z.string().min(1),
    nonce: hex(CHANNEL_NONCE_LENGTH, "nonce"),
    clientPk: hex(X25519_KEY_LENGTH, "clientPk"),
    enclavePk: hex(X25519_KEY_LENGTH, "enclavePk"),
    expectedComposeHash: hex(COMPOSE_HASH_LENGTH, "expectedComposeHash").optional(),
    expectedAppId: hex(APP_ID_LENGTH, "expectedAppId").optional(),
    expectedOsMeasurements: z
      .object({
        mrtd: hex(MEASUREMENT_LENGTH, "mrtd"),
        rtmr0: hex(MEASUREMENT_LENGTH, "rtmr0"),
        rtmr1: hex(MEASUREMENT_LENGTH, "rtmr1"),
        rtmr2: hex(MEASUREMENT_LENGTH, "rtmr2"),
      })
      .optional(),
    mode: z.enum(["tdx", "simulated"]),
    dcapVerifier: z.custom<DcapVerifier>((value) => typeof value === "function").optional(),
  })
  .refine((input) => input.mode !== "tdx" || input.expectedComposeHash !== undefined, {
    message: "expectedComposeHash is mandatory in tdx mode: without it any deployment would be accepted",
    path: ["expectedComposeHash"],
  });

/**
 * Default DCAP verifier: `@phala/dcap-qvl` (pure JS) fetching collateral from Phala's PCCS.
 * Imported lazily so that simulated-mode callers (and browser bundles that never verify real quotes) do not load it.
 */
export const phalaDcapVerifier: DcapVerifier = async (quote) => {
  const { getCollateralAndVerify } = await import("@phala/dcap-qvl");
  const verified = await getCollateralAndVerify(quote);
  const td = verified.report.asTd10() ?? verified.report.asTd15()?.base;
  if (!td) throw new AttestationError("UNSUPPORTED_QUOTE", "DCAP report is not a TDX report");
  return {
    status: verified.status,
    advisoryIds: [...verified.advisory_ids],
    rtmr3: toHex(td.rtMr3),
    reportData: toHex(td.reportData),
  };
};

/** Collects relaxed checks in simulated mode; throws in tdx mode. */
class Policy {
  readonly warnings: string[] = [];
  constructor(readonly strict: boolean) {}

  require(condition: boolean, error: AttestError): void {
    if (condition) return;
    if (this.strict) throw error;
    this.warnings.push(`[simulated] ${error.message}`);
  }
}

async function checkDcap(quote: TdxQuote, verifier: DcapVerifier): Promise<DcapReport> {
  let report: DcapReport;
  try {
    report = await verifier(quote.bytes);
  } catch (error) {
    if (error instanceof AttestError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AttestationError("DCAP_FAILED", `Intel DCAP verification failed: ${message}`, { cause: error });
  }
  if (report.status !== ACCEPTED_TCB_STATUS) {
    throw new AttestationError(
      "TCB_NOT_UP_TO_DATE",
      `platform TCB status is ${report.status}, only ${ACCEPTED_TCB_STATUS} is accepted`,
    );
  }
  // Our parser and the DCAP library must agree on the signed bytes, otherwise we would check unsigned values.
  if (normalizeHex(report.rtmr3) !== quote.rtmrs[3] || normalizeHex(report.reportData) !== quote.reportData) {
    throw new AttestationError("MALFORMED_QUOTE", "DCAP report and parsed quote disagree");
  }
  return report;
}

function checkOsMeasurements(quote: TdxQuote, expected: OsMeasurements): void {
  const pairs: [string, string, string][] = [
    ["MRTD", quote.mrtd, expected.mrtd],
    ["RTMR0", quote.rtmrs[0], expected.rtmr0],
    ["RTMR1", quote.rtmrs[1], expected.rtmr1],
    ["RTMR2", quote.rtmrs[2], expected.rtmr2],
  ];
  for (const [name, actual, wanted] of pairs) {
    if (actual !== normalizeHex(wanted)) {
      throw new AttestationError(
        "OS_MEASUREMENT_MISMATCH",
        `${name} does not match the pinned dstack OS image`,
      );
    }
  }
}

async function runChecks(input: z.infer<typeof inputSchema>): Promise<VerifiedAttestation> {
  const policy = new Policy(input.mode === "tdx");
  const quote = parseTdxQuote(input.quote);

  let tcbStatus: TcbStatus = "Simulated";
  let advisoryIds: string[] = [];
  if (input.mode === "tdx") {
    const report = await checkDcap(quote, input.dcapVerifier ?? phalaDcapVerifier);
    tcbStatus = ACCEPTED_TCB_STATUS;
    advisoryIds = report.advisoryIds;
  } else {
    policy.warnings.push("[simulated] Intel DCAP signature and TCB status were not verified");
  }
  policy.require(!quote.debug, new AttestationError("DEBUG_TD", "the TD runs in debug mode"));

  // Freshness and key binding hold in both modes: the simulator does write the requested report_data.
  const expectedReportData = channelReportData(
    decodeHex(input.nonce, "nonce"),
    decodeHex(input.clientPk, "clientPk"),
    decodeHex(input.enclavePk, "enclavePk"),
  );
  if (toHex(expectedReportData) !== quote.reportData) {
    throw new AttestationError(
      "REPORT_DATA_MISMATCH",
      "quote report_data is not sha512(nonce || clientPk || enclavePk): stale quote or substituted key",
    );
  }

  const events = parseEventLog(input.eventLog);
  assertRtmrsMatch(replayRtmrs(events), quote.rtmrs);
  const identity = extractAppIdentity(events);

  policy.require(
    composeHashOf(input.appCompose) === identity.composeHash,
    new ComposeError("COMPOSE_HASH_MISMATCH", "sha256(app-compose) differs from the attested compose hash"),
  );
  const violations = composePolicyViolations(parseAppCompose(input.appCompose));
  for (const violation of violations) {
    policy.require(false, new ComposeError("COMPOSE_POLICY_VIOLATION", `app-compose: ${violation}`));
  }
  policy.require(
    identity.keyProvider === "kms",
    new EventLogError(
      "KEY_PROVIDER_NOT_KMS",
      `key provider is ${identity.keyProvider ?? "absent"}, expected kms`,
    ),
  );

  if (input.expectedComposeHash && normalizeHex(input.expectedComposeHash) !== identity.composeHash) {
    throw new ComposeError("COMPOSE_HASH_MISMATCH", "attested compose hash is not the expected one");
  }
  if (input.expectedAppId && normalizeHex(input.expectedAppId) !== identity.appId) {
    throw new AttestationError("APP_ID_MISMATCH", "attested app id is not the expected one");
  }
  if (input.expectedOsMeasurements) checkOsMeasurements(quote, input.expectedOsMeasurements);
  if (input.mode === "tdx" && !input.expectedOsMeasurements) {
    policy.warnings.push("dstack OS image not pinned (MRTD/RTMR0-2 not checked)");
  }
  for (const advisory of advisoryIds) policy.warnings.push(`Intel advisory ${advisory}`);

  return {
    ok: true,
    mode: input.mode,
    simulated: input.mode === "simulated",
    tcbStatus,
    advisoryIds,
    composeHash: identity.composeHash,
    enclaveMeasurement: enclaveMeasurementFrom(identity.composeHash),
    appId: identity.appId,
    rtmr3: quote.rtmrs[3],
    keyProvider: identity.keyProvider,
    nonce: normalizeHex(input.nonce),
    clientPk: normalizeHex(input.clientPk),
    enclavePk: normalizeHex(input.enclavePk),
    warnings: policy.warnings,
  };
}

/**
 * Verifies that a quote comes from the expected Badge enclave and is bound to this client's handshake.
 *
 * Checks, in order: Intel DCAP signature + `UpToDate` TCB (tdx only), TD not in debug mode, report_data =
 * sha512(nonce || clientPk || enclavePk), event log replays to RTMR0-3 with RTMR3 event digests recomputed,
 * sha256(appCompose) = attested compose hash, confidentiality flags of app-compose, `kms` key provider, then the
 * pinned compose hash / app id / OS measurements. In simulated mode the platform checks become warnings.
 *
 * Never throws for a bad attestation: returns `{ ok: false, code, reason }`. Unexpected programming errors
 * (not `AttestError`) are rethrown.
 */
export async function verifyAttestation(input: VerifyAttestationInput): Promise<AttestationResult> {
  const mode: AttestationMode = input.mode === "simulated" ? "simulated" : "tdx";
  const reject = (code: AttestErrorCode, reason: string): RejectedAttestation => ({
    ok: false,
    mode,
    simulated: mode === "simulated",
    code,
    reason,
  });
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return reject("INVALID_INPUT", z.prettifyError(parsed.error));
  try {
    return await runChecks(parsed.data);
  } catch (error) {
    if (error instanceof AttestError) return reject(error.code, error.message);
    throw error;
  }
}
