import { decodeHex, toHex } from "./bytes";
import { AttestError, QuoteFormatError } from "./errors";

/** Intel DCAP quote layout (TDX, quote format v4): 48-byte header followed by a 584-byte TD report body. */
const QUOTE_VERSION_V4 = 4;
const TEE_TYPE_TDX = 0x81;
const HEADER_LENGTH = 48;
const TD_REPORT_LENGTH = 584;
const SIGNATURE_LENGTH_FIELD = 4;
const MIN_QUOTE_LENGTH = HEADER_LENGTH + TD_REPORT_LENGTH + SIGNATURE_LENGTH_FIELD;

const HEADER_VERSION_OFFSET = 0;
const HEADER_TEE_TYPE_OFFSET = 4;

/** Offsets inside the TD report body (TDREPORT10), per the Intel TDX DCAP quote specification. */
const TD_ATTRIBUTES_OFFSET = 120;
const MRTD = { offset: 136, length: 48 };
const RTMR = [
  { offset: 328, length: 48 },
  { offset: 376, length: 48 },
  { offset: 424, length: 48 },
  { offset: 472, length: 48 },
] as const;
const REPORT_DATA = { offset: 520, length: 64 };

/** TDATTRIBUTES.DEBUG (bit 0): a debuggable TD lets the host read its memory, so it protects nothing. */
const TD_ATTRIBUTES_DEBUG_BIT = 0x01;

/** Measurements of a TDX quote, as lowercase hex without prefix. */
export interface TdxQuote {
  version: number;
  teeType: number;
  /** Initial TD measurement: firmware of the dstack OS image. */
  mrtd: string;
  /** RTMR0-2 measure the OS image boot chain; RTMR3 holds dstack runtime events (app id, compose hash...). */
  rtmrs: readonly [string, string, string, string];
  /** 64 bytes chosen by the enclave; Badge binds the channel keys and the client nonce here. */
  reportData: string;
  /** True when the TD runs in debug mode (its memory is readable by the host). */
  debug: boolean;
  /** Raw quote bytes, needed by the DCAP signature verification. */
  bytes: Uint8Array;
}

function slice(bytes: Uint8Array, field: { offset: number; length: number }): string {
  const start = HEADER_LENGTH + field.offset;
  return toHex(bytes.subarray(start, start + field.length));
}

/**
 * Parses a TDX v4 quote (hex, optional `0x`, or raw bytes) and extracts its measurements.
 *
 * This only reads the bytes: it does NOT check the Intel signature (see `verifyAttestation` in mode `tdx`).
 * @throws QuoteFormatError when the input is not hex, is truncated, or is not a TDX v4 quote.
 */
export function parseTdxQuote(quote: string | Uint8Array): TdxQuote {
  let bytes: Uint8Array;
  try {
    bytes = typeof quote === "string" ? decodeHex(quote.trim(), "quote") : quote;
  } catch (error) {
    if (error instanceof AttestError) throw new QuoteFormatError("MALFORMED_QUOTE", error.message);
    throw error;
  }
  if (bytes.length < MIN_QUOTE_LENGTH) {
    throw new QuoteFormatError(
      "MALFORMED_QUOTE",
      `quote is ${bytes.length} bytes, a TDX v4 quote needs at least ${MIN_QUOTE_LENGTH}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(HEADER_VERSION_OFFSET, true);
  const teeType = view.getUint32(HEADER_TEE_TYPE_OFFSET, true);
  if (version !== QUOTE_VERSION_V4 || teeType !== TEE_TYPE_TDX) {
    throw new QuoteFormatError(
      "UNSUPPORTED_QUOTE",
      `expected a TDX v4 quote (version ${QUOTE_VERSION_V4}, TEE type 0x${TEE_TYPE_TDX.toString(16)}), ` +
        `got version ${version}, TEE type 0x${teeType.toString(16)}`,
    );
  }
  const signatureLength = view.getUint32(HEADER_LENGTH + TD_REPORT_LENGTH, true);
  if (MIN_QUOTE_LENGTH + signatureLength > bytes.length) {
    throw new QuoteFormatError(
      "MALFORMED_QUOTE",
      `quote declares ${signatureLength} bytes of signature data but only ${bytes.length - MIN_QUOTE_LENGTH} follow`,
    );
  }
  const attributesStart = HEADER_LENGTH + TD_ATTRIBUTES_OFFSET;
  const firstAttributeByte = bytes[attributesStart] ?? 0;
  return {
    version,
    teeType,
    mrtd: slice(bytes, MRTD),
    rtmrs: [slice(bytes, RTMR[0]), slice(bytes, RTMR[1]), slice(bytes, RTMR[2]), slice(bytes, RTMR[3])],
    reportData: slice(bytes, REPORT_DATA),
    debug: (firstAttributeByte & TD_ATTRIBUTES_DEBUG_BIT) !== 0,
    bytes,
  };
}
