/**
 * @badge/client: typed SDK of the Badge enclave API (web app, MCP server, demo script). Browser-safe.
 * Also the reference of the HTTP wire format (request signing, channel payloads, response shapes), which the
 * enclave imports so both ends stay in step.
 */
export * from "./api-schemas";
export {
  AUDIT_HEAD_PREFIX,
  auditHeadMessage,
  checkAuditHead,
  type AuditHeadCheck,
  type AuditHeadProblem,
  type AuditHeadRecord,
} from "./audit-head";
export * from "./channel-wire";
export {
  BadgeClient,
  type ApproveDeskRequestInput,
  type AuditQuery,
  type BadgeClientOptions,
  type CreateDeskRequestInput,
  type CreateTaskInput,
  type RegisterComplianceKeyInput,
  type RevocationTargetInput,
  type RevealNoticeInput,
} from "./client";
export { apiErrorBodySchema, BadgeApiError, type ApiErrorBody, type ClientErrorCode } from "./errors";
export { assertTdxPins, definedPins, ENCLAVE_PIN_ENV, enclavePinsFromEnv, type EnclavePins } from "./pins";
export {
  BADGE_AUTH_HEADERS,
  bodyBytes,
  bodyDigest,
  canonicalRequest,
  MAX_REQUEST_SKEW_MS,
  REQUEST_SIGNING_PREFIX,
  type RequestToSign,
} from "./request-auth";
export {
  createAgentSession,
  DEFAULT_AGENT_ACCESS,
  DEFAULT_AGENT_SESSION_TTL_SECONDS,
  ENCLAVE_MAX_SESSION_TTL_SECONDS,
  type CreateAgentSessionOptions,
  type CreatedAgentSession,
} from "./session";
export { CHANNEL_UNKNOWN_CODE, type FetchLike } from "./transport";
