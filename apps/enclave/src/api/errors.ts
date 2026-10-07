/**
 * Maps every error to the API's single envelope `{ error: { code, message } }` and an HTTP status. Typed domain
 * errors keep their code and message (they are written for the caller); anything unexpected becomes a generic
 * 500 whose details stay in the enclave's log, because an unexpected message could carry internal data.
 */
import { ConsentError, type ConsentErrorCode } from "@badge/consent";
import { ZkError, type ZkErrorCode } from "@badge/zk";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import { ZodError, z } from "zod";
import { EnclaveError, type EnclaveErrorCode } from "../errors";
import { LlmOutputError, LlmRequestError } from "../llm/errors";
import { BriefInputError, MemoryBackendError } from "../memory/errors";

export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

const ENCLAVE_STATUS: Record<EnclaveErrorCode, ContentfulStatusCode> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNKNOWN_EMPLOYEE: 403,
  NOT_ENROLLED: 403,
  NONCE_REUSED: 409,
  ALREADY_EXISTS: 409,
  NOT_PENDING: 409,
  SESSION_TOO_LONG: 422,
  STALE: 422,
  RULE_BLOCKED: 422,
  NO_RULE: 422,
  COMPLIANCE_KEY_MISSING: 409,
  UPSTREAM_FAILED: 502,
};

/** Malformed input is 400; a well-formed message that fails a check is 422; a wrong signer is 403. */
const CONSENT_STATUS: Record<ConsentErrorCode, ContentfulStatusCode> = {
  INVALID_MESSAGE: 400,
  NOT_DEVICE_ASCII: 400,
  SIGNATURE_MALFORMED: 400,
  SIGNATURE_MISMATCH: 403,
  EXPIRED: 422,
  TTL_TOO_LONG: 422,
  NOT_YET_VALID: 422,
  STALE: 422,
  ENCLAVE_MISMATCH: 422,
  EXCERPT_HASH_MISMATCH: 422,
  EXCERPT_LENGTH_MISMATCH: 422,
  EXCERPT_TOO_LONG: 422,
  INVALID_FIELD: 422,
};

const ZK_STATUS: Record<ZkErrorCode, ContentfulStatusCode> = {
  INVALID_SIGNATURE: 400,
  INVALID_INPUT: 400,
  MALFORMED_PROOF: 400,
  INVALID_GROUP: 500,
  NOT_A_MEMBER: 403,
  ARTIFACTS_MISSING: 500,
  PROOF_GENERATION_FAILED: 500,
  WRONG_DEPTH: 422,
  WRONG_ROOT: 422,
  WRONG_MESSAGE: 422,
  WRONG_SCOPE: 422,
  INVALID_PROOF: 422,
  NULLIFIER_REUSED: 409,
};

/** Converts any thrown value into a status and the error envelope. */
export function toErrorResponse(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  const body = (code: string, message: string): ErrorBody => ({ error: { code, message } });
  if (error instanceof EnclaveError)
    return { status: ENCLAVE_STATUS[error.code], body: body(error.code, error.message) };
  if (error instanceof ConsentError)
    return { status: CONSENT_STATUS[error.code], body: body(error.code, error.message) };
  if (error instanceof ZkError)
    return { status: ZK_STATUS[error.code], body: body(error.code, error.message) };
  if (error instanceof ZodError) {
    return { status: 400, body: body("INVALID_REQUEST", z.prettifyError(error)) };
  }
  if (error instanceof HTTPException) {
    return { status: error.status as ContentfulStatusCode, body: body("HTTP_ERROR", error.message) };
  }
  if (
    error instanceof LlmRequestError ||
    error instanceof LlmOutputError ||
    error instanceof MemoryBackendError
  ) {
    // The upstream message may quote the model's output, i.e. excerpt text: never echo it to the caller.
    return { status: 502, body: body("UPSTREAM_FAILED", "the memory or language model backend failed") };
  }
  if (error instanceof BriefInputError) {
    return { status: 409, body: body("NOTHING_TO_BRIEF", "no allowed excerpt to draft a brief from") };
  }
  return { status: 500, body: body("INTERNAL", "internal error") };
}
