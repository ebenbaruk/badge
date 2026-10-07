/**
 * Typed errors of the web server and their mapping to UI messages. Server actions never throw to the client:
 * they return an {@link ActionResult} whose `code` the UI can branch on and whose `message` is French UI copy.
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
  if (error instanceof AgentSessionMissingError)
    return {
      ok: false,
      code: "NO_SESSION",
      message: "Votre agent n'a pas de session active : autorisez-le dans Configuration.",
    };
  if (error instanceof BadgeApiError) return enclaveFailure(error);
  if (error instanceof z.ZodError)
    return { ok: false, code: "INVALID_INPUT", message: "Saisie invalide.", detail: z.prettifyError(error) };
  return { ok: false, code: "INTERNAL", message: "Erreur inattendue du serveur.", detail };
}

/** Failures reported by @badge/client: transport and attestation problems first, then enclave refusals. */
function enclaveFailure(error: BadgeApiError): Extract<ActionResult, { ok: false }> {
  const detail = `${error.code}: ${error.message}`;
  switch (error.code) {
    case "NETWORK_ERROR":
      return {
        ok: false,
        code: "ENCLAVE_UNREACHABLE",
        message: "Enclave injoignable : vérifiez qu'elle est démarrée.",
        detail,
      };
    case "ATTESTATION_FAILED":
      return {
        ok: false,
        code: "ATTESTATION_FAILED",
        message: "Attestation de l'enclave refusée : aucune donnée n'a été envoyée.",
        detail,
      };
    case "SESSION_UNKNOWN":
      return {
        ok: false,
        code: "NO_SESSION",
        message: "La session de votre agent a expiré : renouvelez-la dans Configuration.",
        detail,
      };
    default:
      return {
        ok: false,
        code: "ENCLAVE_REJECTED",
        message: ENCLAVE_REFUSALS[error.code] ?? "L'enclave a refusé la demande.",
        detail,
      };
  }
}

/** French explanations of the enclave refusals a user can run into (docs/enclave-api.md, "Errors"). */
const ENCLAVE_REFUSALS: Readonly<Record<string, string>> = {
  NOT_ENROLLED: "Associez d'abord votre Ledger (Configuration).",
  COMPLIANCE_KEY_MISSING:
    "Aucune clé de conformité n'est enregistrée : la responsable conformité doit l'enregistrer avant tout partage anonyme.",
  NOT_FOUND: "Demande introuvable ou déjà traitée.",
  NOT_PENDING: "Cette demande a déjà été traitée.",
  NONCE_REUSED: "Ce message signé a déjà été utilisé.",
  SIGNATURE_MISMATCH: "La signature ne correspond pas au Ledger attendu.",
  ENCLAVE_MISMATCH: "Le message signé vise une autre enclave (mesure différente).",
  EXPIRED: "Le message signé a expiré.",
  STALE: "Message trop ancien : recommencez.",
  FORBIDDEN: "Action non autorisée pour cet employé.",
  NO_RULE: "Aucune règle d'échange ne permet cette demande entre desks.",
  UPSTREAM_FAILED: "La mémoire ou le modèle de l'enclave n'a pas répondu : réessayez.",
  INVALID_REQUEST: "Requête refusée par l'enclave.",
};

/** Runs `work` and wraps its outcome in an {@link ActionResult}. */
export async function runAction<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return toActionFailure(error);
  }
}
