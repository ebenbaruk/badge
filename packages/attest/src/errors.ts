/** Machine-readable reasons an attestation or a channel message is rejected. */
export type AttestErrorCode =
  | "INVALID_INPUT"
  | "MALFORMED_QUOTE"
  | "UNSUPPORTED_QUOTE"
  | "MALFORMED_EVENT_LOG"
  | "EVENT_DIGEST_MISMATCH"
  | "RTMR_MISMATCH"
  | "MISSING_EVENT"
  | "DUPLICATE_EVENT"
  | "MALFORMED_COMPOSE"
  | "COMPOSE_HASH_MISMATCH"
  | "COMPOSE_POLICY_VIOLATION"
  | "APP_ID_MISMATCH"
  | "OS_MEASUREMENT_MISMATCH"
  | "DEBUG_TD"
  | "REPORT_DATA_MISMATCH"
  | "DCAP_FAILED"
  | "TCB_NOT_UP_TO_DATE"
  | "KEY_PROVIDER_NOT_KMS"
  | "KEY_PROVIDER_MISMATCH"
  | "DSTACK_FAILED"
  | "CHANNEL_UNVERIFIED"
  | "channel_mismatch"
  | "channel_auth_failed"
  | "channel_sequence"
  | "channel_exhausted"
  | "sealed_box_auth_failed";

/** Base class of every error raised by `@badge/attest`: callers branch on `code`, humans read `message`. */
export class AttestError extends Error {
  readonly code: AttestErrorCode;

  constructor(code: AttestErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The TDX quote bytes are truncated, malformed or of an unsupported version/TEE type. */
export class QuoteFormatError extends AttestError {}

/** The dstack event log is malformed, or does not replay to the measurements in the quote. */
export class EventLogError extends AttestError {}

/** The app-compose document is malformed, does not hash to the attested value, or violates the policy. */
export class ComposeError extends AttestError {}

/** The quote is not acceptable evidence (signature, TCB, report_data, pinned measurements). */
export class AttestationError extends AttestError {}

/** A secure-channel message was rejected (tampered, replayed, reordered) or the channel was misused. */
export class ChannelError extends AttestError {}
