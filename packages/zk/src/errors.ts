/** Every way a desk identity, group or proof operation can fail. Verifiers branch on the code, never on text. */
export const ZK_ERROR_CODES = [
  "INVALID_SIGNATURE",
  "INVALID_INPUT",
  "INVALID_GROUP",
  "NOT_A_MEMBER",
  "ARTIFACTS_MISSING",
  "PROOF_GENERATION_FAILED",
  "MALFORMED_PROOF",
  "WRONG_DEPTH",
  "WRONG_ROOT",
  "WRONG_MESSAGE",
  "WRONG_SCOPE",
  "INVALID_PROOF",
  "NULLIFIER_REUSED",
] as const;

export type ZkErrorCode = (typeof ZK_ERROR_CODES)[number];

/** Typed error of the zk package; `cause` keeps the underlying library error when there is one. */
export class ZkError extends Error {
  override readonly name = "ZkError";

  constructor(
    readonly code: ZkErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${code}] ${message}`, options);
  }
}
