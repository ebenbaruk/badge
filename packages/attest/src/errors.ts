/** Machine-readable reasons an attestation or a channel message is rejected. */
export type AttestErrorCode =
  | "invalid_input"
  | "malformed_quote"
  | "unsupported_quote"
  | "malformed_event_log"
  | "event_digest_mismatch"
  | "rtmr_mismatch"
  | "missing_event"
  | "duplicate_event"
  | "malformed_compose"
  | "compose_hash_mismatch"
  | "compose_policy_violation"
  | "app_id_mismatch"
  | "os_measurement_mismatch"
  | "debug_td"
  | "report_data_mismatch"
  | "dcap_failed"
  | "tcb_not_up_to_date"
  | "key_provider_not_kms"
  | "dstack_failed"
  | "channel_unverified"
  | "channel_mismatch"
  | "channel_auth_failed"
  | "channel_sequence"
  | "channel_exhausted";

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
