/** Failure codes of the MCP server's own setup (enclave refusals stay `BadgeApiError` from @badge/client). */
export type McpErrorCode =
  | "CONFIG_INVALID"
  | "SESSION_FILE_INVALID"
  | "SESSION_FILE_INSECURE"
  | "SESSION_FILE_EXISTS"
  | "SESSION_NOT_OPENED"
  | "SESSION_EXPIRED"
  | "ATTESTATION_FAILED"
  | "MEASUREMENT_MISMATCH";

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
