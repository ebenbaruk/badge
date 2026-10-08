/**
 * The compliance officer's X25519 key, derived from her Ledger instead of being stored anywhere.
 *
 * Derivation: the officer signs {@link complianceKeyDeriveMessage} with EIP-191 `personal_sign` on her Ledger;
 * secretKey = keccak256(signature bytes); publicKey = X25519(secretKey). Ledger ECDSA signatures are deterministic
 * (RFC 6979), so the same Ledger and message always give the same key back: nothing to back up, and the key exists
 * only in the officer's browser memory while she reads the audit. Consequences:
 * - the derivation signature IS the secret: it must never be sent to the enclave or logged;
 * - registration uses a second, distinct signature over {@link complianceKeyRegistrationMessage}, which binds the
 *   public key to the officer's Ledger address without revealing anything.
 * EIP-191 rather than EIP-712: the Ledger shows a personal message in clear, without descriptor or blind signing.
 */
import { x25519 } from "@noble/curves/ed25519";
import { keccak_256 } from "@noble/hashes/sha3";
import { decodeHex, toHex } from "./bytes";
import { AttestError } from "./errors";

/** r (32) || s (32) || v (1). */
const SIGNATURE_LENGTH = 65;
/** The Ethereum app shows a non-ASCII personal message as raw hex: keep every line printable ASCII. */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

function assertPrintableAscii(value: string, label: string): void {
  if (!PRINTABLE_ASCII.test(value)) {
    throw new AttestError("INVALID_INPUT", `${label} must be printable ASCII (it is shown on the Ledger)`);
  }
}

/** EIP-191 message whose signature derives the compliance key (same wording every time: determinism). */
export function complianceKeyDeriveMessage(company: string): string {
  assertPrintableAscii(company, "company");
  return [
    "Badge - compliance key",
    `Company: ${company}`,
    "Only sign this message in Badge.",
    "This signature is secret: do not share it.",
  ].join("\n");
}

/** EIP-191 message the officer signs to register `publicKey` (hex) as the company's compliance key. */
export function complianceKeyRegistrationMessage(company: string, publicKey: string): string {
  assertPrintableAscii(company, "company");
  const key = toHex(decodeHex(publicKey, "publicKey", 32));
  return ["Badge - register my compliance key", `Company: ${company}`, `Key: ${key}`].join("\n");
}

/**
 * Derives the compliance X25519 key pair from the Ledger's EIP-191 signature of `complianceKeyDeriveMessage`.
 * @throws AttestError("INVALID_INPUT") when `signature` is not 65 bytes of hex.
 */
export function complianceKeyFromSignature(signature: string): {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const bytes = decodeHex(signature, "signature", SIGNATURE_LENGTH);
  const secretKey = keccak_256(bytes);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}
