/** The memory backend (Honcho) failed or returned something unusable. */
export class MemoryBackendError extends Error {
  override readonly name = "MemoryBackendError";

  constructor(
    message: string,
    /**
     * Content-free description (operation, SDK error class, HTTP status), safe to log inside the CVM. The message
     * is not: Honcho's error text may echo the search query, i.e. the task.
     */
    readonly diagnostic: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Invalid memory configuration (Honcho URL, admin JWT file, workspace). */
export class MemoryConfigError extends Error {
  override readonly name = "MemoryConfigError";
}

/** draftBrief was called without any excerpt the caller explicitly allowed. */
export class BriefInputError extends Error {
  override readonly name = "BriefInputError";
}
