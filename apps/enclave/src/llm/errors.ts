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
    /**
     * Content-free description (route, call, status, provider error type), safe to log inside the CVM. The message
     * is not: it quotes the provider's error body, which may echo part of the request.
     */
    readonly diagnostic: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Why an answer was unusable; part of the diagnostic logged by the enclave. */
export type LlmOutputFailure =
  | "bad_response_shape"
  | "no_choice"
  | "refused"
  | "truncated"
  | "empty"
  | "invalid_json"
  | "schema_mismatch"
  | "missing_embedding"
  | "wrong_dimensions";

/** The endpoint answered, but not with what was asked (truncated, refused, invalid JSON, schema mismatch). */
export class LlmOutputError extends Error {
  override readonly name = "LlmOutputError";

  constructor(
    message: string,
    readonly failure: LlmOutputFailure,
    /**
     * Content-free description (call, failure, schema issue paths and codes), safe to log inside the CVM. The
     * message is not: it may quote the model's output, i.e. excerpt text.
     */
    readonly diagnostic: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
