/**
 * @badge/client: typed SDK of the Badge enclave API (web app, MCP server, demo script). Browser-safe.
 * Also the reference of the HTTP wire format (request signing, channel payloads, response shapes), which the
 * enclave imports so both ends stay in step.
 */
export * from "./api-schemas";
export * from "./channel-wire";
export {
  BadgeClient,
  type ApproveDeskRequestInput,
  type BadgeClientOptions,
  type CreateDeskRequestInput,
  type CreateTaskInput,
  type RegisterComplianceKeyInput,
  type RevealNoticeInput,
} from "./client";
export { apiErrorBodySchema, BadgeApiError, type ApiErrorBody, type ClientErrorCode } from "./errors";
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
