/** The LLM profile is missing, incomplete or inconsistent (checked once at startup). */
export class LlmConfigError extends Error {
  override readonly name = "LlmConfigError";
}

/** The upstream endpoint refused or failed the request (HTTP error, timeout, network). */
export class LlmRequestError extends Error {
  override readonly name = "LlmRequestError";

  constructor(
    message: string,
    /** HTTP status, or undefined for network errors and timeouts. */
    readonly status: number | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** The endpoint answered, but not with what was asked (truncated, refused, invalid JSON, schema mismatch). */
export class LlmOutputError extends Error {
  override readonly name = "LlmOutputError";
}
