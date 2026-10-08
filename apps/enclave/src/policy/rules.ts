/**
 * Deterministic mass-extraction rules. They run on every request for a third party's personal context, before the
 * owner is asked anything, and need no model: an agent that was prompt-injected into "exfiltrate everything" is
 * caught by size and rate, whatever words it uses.
 *
 * Outcomes: `ok`; `warn` (the owner sees explicit reasons next to the consent, compliance gets an audit entry, and
 * a standing policy no longer auto-allows); `block` (refused, never reaches the owner).
 */

/**
 * Named thresholds, calibrated on the demo dataset: a personal note is 80 to 260 characters and an owner's whole
 * context about 1,000; a legitimate brief touches one or two owners and a few notes each.
 */
export const EXTRACTION_THRESHOLDS = {
  /** One excerpt above this is far bigger than a note: probably a dump. */
  excerptWarnChars: 600,
  /** Hard cap per excerpt: above it the request is refused before it reaches the owner. */
  excerptBlockChars: 8_000,
  /** Share of the owner's whole context requested by one task above which the owner is warned. */
  ownerShareWarn: 0.9,
  /** Distinct third-party owners in one task from which the request looks like a sweep. */
  distinctOwnersWarn: 3,
  /** Distinct third-party owners in one task above which the task is refused. */
  distinctOwnersBlock: 6,
  /** Requests for one owner's context in the last hour (all requesters) from which the owner is warned. */
  ownerRequestsPerHourWarn: 20,
  /** Requests for one owner's context in the last hour above which new ones are refused. */
  ownerRequestsPerHourBlock: 60,
} as const;

export type RiskOutcome = "ok" | "warn" | "block";

export const RISK_REASON_CODES = [
  "EXCERPT_LONG",
  "EXCERPT_OVER_CAP",
  "OWNER_SHARE_HIGH",
  "MANY_OWNERS",
  "TOO_MANY_OWNERS",
  "OWNER_RATE_HIGH",
  "OWNER_RATE_OVER_CAP",
  "FULL_CONTEXT_REQUEST",
  /** Not a threshold rule: the owner has no Ledger, so no consent can ever be given (tasks/service.ts). */
  "OWNER_CANNOT_CONSENT",
] as const;
export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

/** A reason shown to the owner (English, for the web app; the device only shows the signed fields). */
export interface RiskReason {
  readonly code: RiskReasonCode;
  readonly severity: "warn" | "block";
  readonly message: string;
}

export interface ExtractionInput {
  /** Length of this excerpt, in characters. */
  readonly excerptLength: number;
  /** Size of the owner's whole context, in characters (0 when unknown). */
  readonly ownerContextLength: number;
  /** Characters of this owner's context requested by the whole task, this excerpt included. */
  readonly requestedFromOwnerInTask: number;
  /** Distinct third-party owners whose personal context the task requests. */
  readonly distinctOwnersInTask: number;
  /** Requests for this owner's context in the last hour, this task excluded. */
  readonly ownerRequestsLastHour: number;
  /** The agent explicitly asked for the owner's entire context. */
  readonly fullContextRequest: boolean;
}

export interface ExtractionVerdict {
  readonly outcome: RiskOutcome;
  readonly reasons: readonly RiskReason[];
}

const PERCENT = 100;

/** Applies every rule and returns the most severe outcome with all the reasons that apply. */
export function evaluateExtraction(
  input: ExtractionInput,
  thresholds: typeof EXTRACTION_THRESHOLDS = EXTRACTION_THRESHOLDS,
): ExtractionVerdict {
  const reasons: RiskReason[] = [];
  const add = (code: RiskReasonCode, severity: RiskReason["severity"], message: string) =>
    reasons.push({ code, severity, message });

  if (input.excerptLength > thresholds.excerptBlockChars) {
    add(
      "EXCERPT_OVER_CAP",
      "block",
      `Excerpt of ${input.excerptLength} characters, over the ${thresholds.excerptBlockChars}-character cap.`,
    );
  } else if (input.excerptLength > thresholds.excerptWarnChars) {
    add(
      "EXCERPT_LONG",
      "warn",
      `Unusually long excerpt (${input.excerptLength} characters, threshold ${thresholds.excerptWarnChars}).`,
    );
  }

  // An unknown context size counts as "everything": failing closed means warning, not staying silent.
  const share = input.ownerContextLength > 0 ? input.requestedFromOwnerInTask / input.ownerContextLength : 1;
  if (share >= thresholds.ownerShareWarn) {
    add(
      "OWNER_SHARE_HIGH",
      "warn",
      `The task asks for ${Math.min(PERCENT, Math.round(share * PERCENT))}% of your personal context.`,
    );
  }

  if (input.distinctOwnersInTask > thresholds.distinctOwnersBlock) {
    add(
      "TOO_MANY_OWNERS",
      "block",
      `The task targets the context of ${input.distinctOwnersInTask} people (cap ${thresholds.distinctOwnersBlock}).`,
    );
  } else if (input.distinctOwnersInTask >= thresholds.distinctOwnersWarn) {
    add(
      "MANY_OWNERS",
      "warn",
      `The task targets the context of ${input.distinctOwnersInTask} people at once.`,
    );
  }

  if (input.ownerRequestsLastHour >= thresholds.ownerRequestsPerHourBlock) {
    add(
      "OWNER_RATE_OVER_CAP",
      "block",
      `${input.ownerRequestsLastHour} requests on your context in the last hour (cap ${thresholds.ownerRequestsPerHourBlock}).`,
    );
  } else if (input.ownerRequestsLastHour >= thresholds.ownerRequestsPerHourWarn) {
    add(
      "OWNER_RATE_HIGH",
      "warn",
      `${input.ownerRequestsLastHour} requests on your context in the last hour.`,
    );
  }

  if (input.fullContextRequest) {
    add(
      "FULL_CONTEXT_REQUEST",
      "warn",
      "The agent is asking for your entire context, not a targeted excerpt.",
    );
  }

  const outcome: RiskOutcome = reasons.some((r) => r.severity === "block")
    ? "block"
    : reasons.length > 0
      ? "warn"
      : "ok";
  return { outcome, reasons };
}
