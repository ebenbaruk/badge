import { z } from "zod";

/**
 * Error body returned by every enclave route: `{ error: { code, message } }`. `code` is a stable machine string
 * (e.g. `SESSION_UNKNOWN`, `CLOCK_SKEW`, `NOT_FOUND`); `message` is for humans and logs.
 */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().max(2048),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

/** Error codes produced by the SDK itself (never sent by the enclave). */
export type ClientErrorCode =
  | "NETWORK_ERROR"
  | "BAD_RESPONSE"
  | "ATTESTATION_FAILED"
  | "CHANNEL_FAILED"
  | "NO_SESSION_KEY"
  | "INVALID_ARGUMENT";

/**
 * Any failure of a {@link BadgeClient} call. `status` is the HTTP status (0 for failures before or outside HTTP),
 * `code` the enclave's error code or a {@link ClientErrorCode}.
 */
export class BadgeApiError extends Error {
  override readonly name = "BadgeApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  /** True when the enclave refused the call (4xx), as opposed to a transport or server failure. */
  get isRefusal(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}
