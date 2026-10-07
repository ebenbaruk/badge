/**
 * Typed errors of the Ledger package. Every failure surfaces as a {@link LedgerError} subclass so callers can
 * branch on `instanceof` (e.g. show "refused on the device" vs "device unreachable") without parsing messages.
 */

/** Base class of every error thrown by `@badge/ledger`. */
export class LedgerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The Speculos instance (or the DMK session on top of it) cannot be reached or opened. */
export class LedgerConnectionError extends LedgerError {}

/** The Speculos REST API answered with a non-2xx status or an unexpected body. */
export class SpeculosHttpError extends LedgerError {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    detail: string,
  ) {
    super(`Speculos ${endpoint} failed with HTTP ${status}: ${detail}`);
  }
}

/** Automated navigation of the device screens could not complete (unexpected screen, stuck, timeout). */
export class DeviceNavigationError extends LedgerError {
  constructor(
    message: string,
    readonly lastScreen: readonly string[] = [],
  ) {
    super(lastScreen.length > 0 ? `${message} (last screen: ${lastScreen.join(" | ")})` : message);
  }
}

/** The local clear-signing material (CAL test key, PKI certificate) is missing or unusable. */
export class ClearSignSetupError extends LedgerError {}

/** A displayed string field is not printable ASCII: the device would show something else than what is signed. */
export class NonAsciiFieldError extends LedgerError {
  constructor(readonly field: string) {
    super(
      `Field "${field}" contains non printable-ASCII characters; the Ledger would display a corrupted value. ` +
        "Fold it to device ASCII before signing.",
    );
  }
}

/** The signature returned by the device does not recover to the device address (fail closed, never returned). */
export class SignatureMismatchError extends LedgerError {}

/**
 * Hints for the APDU status words we actually hit while building Badge. The raw Ledger messages ("Invalid data")
 * say nothing about the cause, so each hint names the likely root cause and the fix.
 */
export const STATUS_WORD_HINTS: Readonly<Record<string, string>> = {
  "6985": "Rejected on the device by the user.",
  "6982": "Security status not satisfied: the device is locked or the action was cancelled on the device.",
  "6a80":
    "For EIP-712 this almost always means the device refused the clear-signing filters " +
    "(signed with the CAL test key: only accepted by Speculos with its test PKI root, never by a real device " +
    "or Speculos --pki-prod), or that the message has no descriptor and blind signing is disabled.",
  "6a84": "Insufficient memory on the device: the message has too many fields or too long strings.",
  "6a88":
    "Data not found: a referenced context (filter, contact, certificate) was not provided before signing.",
  "6d00": "Instruction not supported: the Ethereum app is not open or is too old for this command.",
  "6e00": "Class not supported: the Ethereum app is not open on the device.",
  "911c": "Ledger PKI not available on this app/firmware: use the app-ethereum develop build on Speculos.",
};

/** A device action failed with an error coming from the device or the DMK. */
export class DeviceActionError extends LedgerError {
  constructor(
    readonly action: string,
    /** APDU status word (4 hex chars, lower case) when the device returned one. */
    readonly statusWord: string | undefined,
    /** DMK error tag, e.g. `EthAppCommandError`, `DeviceLockedError`. */
    readonly tag: string,
    deviceMessage: string,
    options?: ErrorOptions,
  ) {
    const hint = statusWord === undefined ? undefined : STATUS_WORD_HINTS[statusWord];
    const code = statusWord === undefined ? tag : `${tag} ${statusWord}`;
    super(`${action} failed (${code}): ${deviceMessage}${hint === undefined ? "" : ` -- ${hint}`}`, options);
  }
}

/** The user refused the action on the device (status word 6985). */
export class UserRejectedError extends DeviceActionError {}

/** The caller aborted a pending device action (its `AbortSignal` fired). */
export class DeviceActionAbortedError extends LedgerError {}

const USER_REJECTED_STATUS_WORD = "6985";

/** Shape of the errors emitted by DMK device actions (`DmkError` / `DeviceExchangeError`), read defensively. */
interface DmkErrorLike {
  _tag?: unknown;
  errorCode?: unknown;
  message?: unknown;
}

/**
 * Converts an error emitted by a DMK device action into a typed {@link DeviceActionError}.
 * @param action - human readable action name, used in the message (e.g. `signTypedData(ContextShare)`).
 */
export function toDeviceActionError(action: string, error: unknown): DeviceActionError {
  const dmk: DmkErrorLike = typeof error === "object" && error !== null ? (error as DmkErrorLike) : {};
  const tag = typeof dmk._tag === "string" ? dmk._tag : error instanceof Error ? error.name : "UnknownError";
  const statusWord = typeof dmk.errorCode === "string" ? dmk.errorCode.toLowerCase() : undefined;
  const message =
    typeof dmk.message === "string" && dmk.message.length > 0
      ? dmk.message
      : error instanceof Error
        ? error.message
        : String(error);
  const ErrorClass = statusWord === USER_REJECTED_STATUS_WORD ? UserRejectedError : DeviceActionError;
  return new ErrorClass(action, statusWord, tag, message, { cause: error });
}
