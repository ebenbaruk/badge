/**
 * Typed errors of the web server and their mapping to UI messages. Server actions never throw to the client:
 * they return an {@link ActionResult} whose `code` the UI can branch on and whose `message` is English UI copy.
 */
import { BadgeApiError } from "@badge/client";
import { ConsentError } from "@badge/consent";
import {
  DeviceActionAbortedError,
  DeviceNavigationError,
  LedgerConnectionError,
  LedgerError,
  UserRejectedError,
} from "@badge/ledger";
import { ZkError } from "@badge/zk";
import { z } from "zod";

export const ENCLAVE_ERROR_CODES = [
  "NOT_FOUND",
  "FORBIDDEN",
  "CONFLICT",
  "INVALID_REQUEST",
  "SIGNATURE_REJECTED",
  "PROOF_REJECTED",
  "NOT_ENROLLED",
] as const;
export type EnclaveErrorCode = (typeof ENCLAVE_ERROR_CODES)[number];

/** The enclave (or its mock) refused a request. */
export class EnclaveError extends Error {
  override readonly name = "EnclaveError";
  constructor(
    readonly code: EnclaveErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * The employee's agent has no usable session key in this bridge (never delegated, expired, or no longer known to the
 * enclave, e.g. after its data was reset). Fixed by a new AgentSession signed on the Ledger.
 */
export class AgentSessionMissingError extends Error {
  override readonly name = "AgentSessionMissingError";
  readonly code = "NO_SESSION";
  constructor(readonly employee: string) {
    super(`no active agent session for ${employee}`);
  }
}

/** Invalid server configuration (environment variables). */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export const ACTION_ERROR_CODES = [
  "LEDGER_REJECTED",
  "LEDGER_UNREACHABLE",
  "LEDGER_NAVIGATION",
  "LEDGER_ERROR",
  "CONSENT_INVALID",
  "ZK_ERROR",
  "ENCLAVE_REJECTED",
  "ENCLAVE_UNREACHABLE",
  "ATTESTATION_FAILED",
  "NO_SESSION",
  "INVALID_INPUT",
  "INTERNAL",
] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: ActionErrorCode; message: string; detail?: string };

/** Maps any thrown value to a UI-safe failure. Logged server-side: errors are never swallowed. */
export function toActionFailure(error: unknown): Extract<ActionResult, { ok: false }> {
  // A missing agent session is a normal state before onboarding (pages poll every few seconds): it is shown to the
  // user, not logged as a server error.
  if (!(error instanceof AgentSessionMissingError)) console.error("[badge/web]", error);
  const detail = error instanceof Error ? error.message : String(error);
  // UserRejectedError extends DeviceActionError: test it before the generic Ledger errors.
  if (error instanceof UserRejectedError)
    return { ok: false, code: "LEDGER_REJECTED", message: "Rejected on Ledger." };
  if (error instanceof LedgerConnectionError)
    return {
      ok: false,
      code: "LEDGER_UNREACHABLE",
      message: "Ledger unreachable: check that the device (Speculos) is running.",
      detail,
    };
  if (error instanceof DeviceNavigationError)
    return {
      ok: false,
      code: "LEDGER_NAVIGATION",
      message: "Auto review did not complete on the device.",
      detail,
    };
  if (error instanceof DeviceActionAbortedError)
    return { ok: false, code: "LEDGER_ERROR", message: "Signing cancelled.", detail };
  if (error instanceof LedgerError)
    return { ok: false, code: "LEDGER_ERROR", message: "The Ledger returned an error.", detail };
  if (error instanceof ConsentError)
    return {
      ok: false,
      code: "CONSENT_INVALID",
      message: "Invalid consent message: signature refused.",
      detail: `${error.code}: ${detail}`,
    };
  if (error instanceof ZkError)
    return {
      ok: false,
      code: "ZK_ERROR",
      message: "The ZK proof could not be produced or is invalid.",
      detail,
    };
  if (error instanceof EnclaveError)
    return {
      ok: false,
      code: "ENCLAVE_REJECTED",
      message: `The enclave refused the request: ${error.message}`,
      detail: error.code,
    };
  if (error instanceof AgentSessionMissingError)
    return {
      ok: false,
      code: "NO_SESSION",
      message: "Your agent has no active session: authorize it in Setup.",
    };
  if (error instanceof BadgeApiError) return enclaveFailure(error);
  if (error instanceof z.ZodError)
    return { ok: false, code: "INVALID_INPUT", message: "Invalid input.", detail: z.prettifyError(error) };
  return { ok: false, code: "INTERNAL", message: "Unexpected server error.", detail };
}

/** Failures reported by @badge/client: transport and attestation problems first, then enclave refusals. */
function enclaveFailure(error: BadgeApiError): Extract<ActionResult, { ok: false }> {
  const detail = `${error.code}: ${error.message}`;
  switch (error.code) {
    case "NETWORK_ERROR":
      return {
        ok: false,
        code: "ENCLAVE_UNREACHABLE",
        message: "Enclave unreachable: check that it is running.",
        detail,
      };
    case "ATTESTATION_FAILED":
      return {
        ok: false,
        code: "ATTESTATION_FAILED",
        message: "Enclave attestation rejected: no data was sent.",
        detail,
      };
    case "SESSION_UNKNOWN":
      return {
        ok: false,
        code: "NO_SESSION",
        message: "Your agent's session has expired: renew it in Setup.",
        detail,
      };
    default:
      return {
        ok: false,
        code: "ENCLAVE_REJECTED",
        message: ENCLAVE_REFUSALS[error.code] ?? "The enclave refused the request.",
        detail,
      };
  }
}

/** Plain-English explanations of the enclave refusals a user can run into (docs/enclave-api.md, "Errors"). */
const ENCLAVE_REFUSALS: Readonly<Record<string, string>> = {
  NOT_ENROLLED: "Pair your Ledger first (Setup).",
  COMPLIANCE_KEY_MISSING:
    "No compliance key is registered: the compliance officer must register one before any anonymous share.",
  NOT_FOUND: "Request not found or already handled.",
  NOT_PENDING: "This request has already been handled.",
  NONCE_REUSED: "This signed message has already been used.",
  SIGNATURE_MISMATCH: "The signature does not match the expected Ledger.",
  ENCLAVE_MISMATCH: "The signed message targets another enclave (different measurement).",
  EXPIRED: "The signed message has expired.",
  STALE: "Message too old: please try again.",
  FORBIDDEN: "Action not allowed for this employee.",
  NO_RULE: "No exchange rule allows this request between desks.",
  UPSTREAM_FAILED: "The enclave's memory or model did not respond: please try again.",
  INVALID_REQUEST: "Request refused by the enclave.",
};

/** Runs `work` and wraps its outcome in an {@link ActionResult}. */
export async function runAction<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return toActionFailure(error);
  }
}
