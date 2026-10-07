/**
 * Domain errors of the enclave. Domain modules throw them with a stable machine code; the HTTP layer maps the code
 * to a status (src/api/errors.ts). Signature and proof failures keep their own typed errors (@badge/consent,
 * @badge/zk), which the HTTP layer maps as well.
 */

export const ENCLAVE_ERROR_CODES = [
  "INVALID_REQUEST",
  "FORBIDDEN",
  "NOT_FOUND",
  "UNKNOWN_EMPLOYEE",
  "NOT_ENROLLED",
  "NONCE_REUSED",
  "ALREADY_EXISTS",
  "NOT_PENDING",
  "SESSION_TOO_LONG",
  "STALE",
  "RULE_BLOCKED",
  "NO_RULE",
  "COMPLIANCE_KEY_MISSING",
  "UPSTREAM_FAILED",
] as const;

export type EnclaveErrorCode = (typeof ENCLAVE_ERROR_CODES)[number];

/** A refused or impossible operation; branch on `code`, never on the message. */
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
