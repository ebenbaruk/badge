/**
 * Typed errors of the web server and their mapping to UI messages. Server actions never throw to the client:
 * they return an {@link ActionResult} whose `code` the UI can branch on and whose `message` is French UI copy.
 */
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

/** Live mode is selected but the integrator has not wired @badge/client yet. */
export class NotWiredError extends Error {
  override readonly name = "NotWiredError";
  readonly code = "NOT_WIRED";
  constructor(readonly method: string) {
    super(`Live enclave method "${method}" is not wired yet (set BADGE_ENCLAVE_MODE=mock for the demo)`);
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
  "NOT_WIRED",
  "INVALID_INPUT",
  "INTERNAL",
] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: ActionErrorCode; message: string; detail?: string };

/** Maps any thrown value to a UI-safe failure. Logged server-side: errors are never swallowed. */
export function toActionFailure(error: unknown): Extract<ActionResult, { ok: false }> {
  console.error("[badge/web]", error);
  const detail = error instanceof Error ? error.message : String(error);
  // UserRejectedError extends DeviceActionError: test it before the generic Ledger errors.
  if (error instanceof UserRejectedError)
    return { ok: false, code: "LEDGER_REJECTED", message: "Refusé sur le Ledger." };
  if (error instanceof LedgerConnectionError)
    return {
      ok: false,
      code: "LEDGER_UNREACHABLE",
      message: "Ledger injoignable : vérifiez que l'appareil (Speculos) est démarré.",
      detail,
    };
  if (error instanceof DeviceNavigationError)
    return {
      ok: false,
      code: "LEDGER_NAVIGATION",
      message: "La revue automatique n'a pas abouti sur l'appareil.",
      detail,
    };
  if (error instanceof DeviceActionAbortedError)
    return { ok: false, code: "LEDGER_ERROR", message: "Signature annulée.", detail };
  if (error instanceof LedgerError)
    return { ok: false, code: "LEDGER_ERROR", message: "Le Ledger a renvoyé une erreur.", detail };
  if (error instanceof ConsentError)
    return {
      ok: false,
      code: "CONSENT_INVALID",
      message: "Message de consentement invalide : signature refusée.",
      detail: `${error.code}: ${detail}`,
    };
  if (error instanceof ZkError)
    return { ok: false, code: "ZK_ERROR", message: "Preuve ZK impossible à produire ou invalide.", detail };
  if (error instanceof EnclaveError)
    return {
      ok: false,
      code: "ENCLAVE_REJECTED",
      message: `L'enclave a refusé la demande : ${error.message}`,
      detail: error.code,
    };
  if (error instanceof NotWiredError)
    return { ok: false, code: "NOT_WIRED", message: "Mode enclave réel pas encore branché.", detail };
  if (error instanceof z.ZodError)
    return { ok: false, code: "INVALID_INPUT", message: "Saisie invalide.", detail: z.prettifyError(error) };
  return { ok: false, code: "INTERNAL", message: "Erreur inattendue du serveur.", detail };
}

/** Runs `work` and wraps its outcome in an {@link ActionResult}. */
export async function runAction<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return toActionFailure(error);
  }
}
