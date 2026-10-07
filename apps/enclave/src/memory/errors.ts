/** The memory backend (Honcho) failed or returned something unusable. */
export class MemoryBackendError extends Error {
  override readonly name = "MemoryBackendError";
}

/** Invalid memory configuration (Honcho URL, admin JWT file, workspace). */
export class MemoryConfigError extends Error {
  override readonly name = "MemoryConfigError";
}

/** draftBrief was called without any excerpt the caller explicitly allowed. */
export class BriefInputError extends Error {
  override readonly name = "BriefInputError";
}
