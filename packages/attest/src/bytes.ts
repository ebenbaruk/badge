import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { AttestError } from "./errors";

const HEX_PATTERN = /^(0x)?([0-9a-fA-F]{2})*$/;

/**
 * Decodes a hex string (optional `0x` prefix) and enforces its byte length when given.
 * Throws `AttestError("INVALID_INPUT")` naming `label`, so a bad field is easy to locate.
 */
export function decodeHex(value: string, label: string, expectedLength?: number): Uint8Array {
  if (!HEX_PATTERN.test(value)) {
    throw new AttestError("INVALID_INPUT", `${label} is not a valid hex string`);
  }
  const bytes = hexToBytes(value.startsWith("0x") ? value.slice(2) : value);
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new AttestError("INVALID_INPUT", `${label} must be ${expectedLength} bytes, got ${bytes.length}`);
  }
  return bytes;
}

/** Lowercase hex without prefix: the canonical form used in every comparison of this package. */
export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

/** Normalises a hex string (strips `0x`, lowercases) so that two encodings of the same bytes compare equal. */
export function normalizeHex(value: string): string {
  return (value.startsWith("0x") ? value.slice(2) : value).toLowerCase();
}

export { concatBytes, utf8ToBytes } from "@noble/hashes/utils";
