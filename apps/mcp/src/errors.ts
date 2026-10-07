/** Failure codes of the MCP server's own setup (enclave refusals stay `BadgeApiError` from @badge/client). */
export type McpErrorCode =
  | "config_invalid"
  | "session_file_invalid"
  | "session_file_insecure"
  | "session_file_exists"
  | "session_not_opened"
  | "session_expired"
  | "attestation_failed"
  | "measurement_mismatch";

/** A setup error: the server refuses to start (fail closed) and prints `message`, never a secret. */
export class McpSetupError extends Error {
  override readonly name = "McpSetupError";

  constructor(
    readonly code: McpErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
