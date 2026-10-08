/**
 * Deterministic mass-extraction rules (pure), evaluated on every cross-owner request before it can reach the
 * owner. `warn` still reaches the owner, with the findings shown in red and a compliance alert; `block` never
 * reaches the owner. Thresholds are named constants so compliance can read and tune them.
 */
import type { RuleFinding, RuleOutcome } from "../enclave/types";

/** An excerpt this long is unusual for a task-scoped request. */
export const EXCERPT_LENGTH_WARN = 900;
/** Beyond this, the request is an export, not a share. */
export const EXCERPT_LENGTH_BLOCK = 4000;
/** Share of the owner's whole personal context requested at once. */
export const OWNER_SHARE_WARN = 0.8;
/** Distinct owners a single task may pull personal context from. */
export const DISTINCT_OWNERS_BLOCK = 4;
/** Requests to the same owner within an hour (consent fatigue / scraping). */
export const REQUESTS_PER_OWNER_HOUR_WARN = 4;
export const REQUESTS_PER_OWNER_HOUR_BLOCK = 8;

export interface ExtractionRequest {
  excerptLength: number;
  ownerTotalLength: number;
  distinctOwnersInTask: number;
  /** Requests already made to this owner in the last hour, this one excluded. */
  recentRequestsToOwner: number;
  /** The agent asked for an owner's entire context instead of searching for a task. */
  fullContextRequest: boolean;
}

export interface RuleEvaluation {
  outcome: RuleOutcome;
  findings: RuleFinding[];
}

const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

export function evaluateExtraction(request: ExtractionRequest): RuleEvaluation {
  const findings: RuleFinding[] = [];
  const share = request.ownerTotalLength > 0 ? request.excerptLength / request.ownerTotalLength : 0;

  if (request.fullContextRequest) {
    findings.push({
      rule: "full-context",
      outcome: "warn",
      message: "The agent asks for your entire personal context, with no task-scoped search.",
    });
  }
  if (request.excerptLength > EXCERPT_LENGTH_BLOCK) {
    findings.push({
      rule: "excerpt-length",
      outcome: "block",
      message: `Excerpt of ${request.excerptLength} characters (maximum ${EXCERPT_LENGTH_BLOCK}).`,
    });
  } else if (request.excerptLength > EXCERPT_LENGTH_WARN) {
    findings.push({
      rule: "excerpt-length",
      outcome: "warn",
      message: `Unusually long excerpt: ${request.excerptLength} characters (threshold ${EXCERPT_LENGTH_WARN}).`,
    });
  }
  if (share >= OWNER_SHARE_WARN) {
    findings.push({
      rule: "owner-share",
      outcome: "warn",
      message: `${percent(share)} of your personal context requested at once (threshold ${percent(OWNER_SHARE_WARN)}).`,
    });
  }
  if (request.distinctOwnersInTask >= DISTINCT_OWNERS_BLOCK) {
    findings.push({
      rule: "distinct-owners",
      outcome: "block",
      message: `A single task targets ${request.distinctOwnersInTask} people (maximum ${DISTINCT_OWNERS_BLOCK - 1}).`,
    });
  }
  const requestsThisHour = request.recentRequestsToOwner + 1;
  if (requestsThisHour >= REQUESTS_PER_OWNER_HOUR_BLOCK) {
    findings.push({
      rule: "owner-rate",
      outcome: "block",
      message: `${requestsThisHour} requests to the same person within an hour (maximum ${REQUESTS_PER_OWNER_HOUR_BLOCK - 1}).`,
    });
  } else if (requestsThisHour >= REQUESTS_PER_OWNER_HOUR_WARN) {
    findings.push({
      rule: "owner-rate",
      outcome: "warn",
      message: `${requestsThisHour} requests to the same person within an hour.`,
    });
  }

  const outcome: RuleOutcome = findings.some((f) => f.outcome === "block")
    ? "block"
    : findings.length > 0
      ? "warn"
      : "ok";
  return { outcome, findings };
}
