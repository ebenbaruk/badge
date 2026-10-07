/**
 * Typed consent errors. Every check in this package throws (never returns a boolean) so that a caller who forgets
 * to look at a result cannot accidentally accept a consent: the package fails closed by construction.
 */

/** Machine-readable reasons, stable across versions: the enclave logs them and the web app maps them to UI text. */
export const CONSENT_ERROR_CODES = [
  "INVALID_MESSAGE",
  "NOT_DEVICE_ASCII",
  "SIGNATURE_MALFORMED",
  "SIGNATURE_MISMATCH",
  "EXPIRED",
  "TTL_TOO_LONG",
  "NOT_YET_VALID",
  "STALE",
  "ENCLAVE_MISMATCH",
  "EXCERPT_HASH_MISMATCH",
  "EXCERPT_LENGTH_MISMATCH",
  "EXCERPT_TOO_LONG",
  "INVALID_FIELD",
] as const;

export type ConsentErrorCode = (typeof CONSENT_ERROR_CODES)[number];

/** Base class of every error thrown by `@badge/consent`; branch on `code`, not on the message. */
export class ConsentError extends Error {
  override readonly name: string = "ConsentError";

  constructor(
    readonly code: ConsentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** A wire payload does not match the schema of its message kind. */
export class InvalidMessageError extends ConsentError {
  override readonly name = "InvalidMessageError";

  constructor(message: string, options?: ErrorOptions) {
    super("INVALID_MESSAGE", message, options);
  }
}

/** A string that the Ledger would display is not in canonical device ASCII (see `toDeviceAscii`). */
export class NotDeviceAsciiError extends ConsentError {
  override readonly name = "NotDeviceAsciiError";

  constructor(
    readonly field: string,
    readonly value: string,
  ) {
    super("NOT_DEVICE_ASCII", `${field} is not canonical device ASCII: ${JSON.stringify(value)}`);
  }
}

/** The signature bytes cannot be parsed or no address can be recovered from them. */
export class MalformedSignatureError extends ConsentError {
  override readonly name = "MalformedSignatureError";

  constructor(message: string, options?: ErrorOptions) {
    super("SIGNATURE_MALFORMED", message, options);
  }
}

/** The signature is valid EIP-712 but was produced by someone other than the expected signer. */
export class SignatureMismatchError extends ConsentError {
  override readonly name = "SignatureMismatchError";

  constructor(
    readonly expected: string,
    readonly recovered: string,
  ) {
    super("SIGNATURE_MISMATCH", `signature recovers to ${recovered}, expected ${expected}`);
  }
}
