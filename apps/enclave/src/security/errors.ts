import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Machine-readable reasons the security layer refuses a request (sent as `error.code`). */
export type SecurityErrorCode =
  | "auth_missing"
  | "auth_malformed"
  | "clock_skew"
  | "bad_signature"
  | "replay"
  | "replay_cache_full"
  | "session_unknown"
  | "body_too_large"
  | "invalid_body"
  | "channel_required"
  | "channel_unknown"
  | "channel_exists"
  | "channel_capacity"
  | "channel_rejected"
  | "dstack_failed";

/** A refusal by the security layer, with the HTTP status it maps to. */
export class SecurityError extends Error {
  override readonly name = "SecurityError";

  constructor(
    readonly code: SecurityErrorCode,
    readonly status: ContentfulStatusCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Renders a {@link SecurityError} in the API error format `{ error: { code, message } }` (see `@badge/client`).
 * Middlewares answer directly instead of throwing, so the refusal never depends on how the app's `onError` is set up.
 */
export function securityErrorResponse(c: Context, error: SecurityError): Response {
  return c.json({ error: { code: error.code, message: error.message } }, error.status);
}
