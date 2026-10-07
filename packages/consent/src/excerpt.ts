/**
 * Excerpt fingerprints. A consent binds the *exact* text that may leave the owner's scope: the enclave recomputes
 * the hash and the length from the text it is about to release and refuses on any difference.
 */
import { encodePacked, keccak256, stringToBytes, type Hex } from "viem";

/**
 * keccak256 of the UTF-8 bytes of the excerpt, as signed in `excerptHash`.
 * The text is hashed as is (no Unicode normalization): the enclave hashes the bytes it actually releases.
 */
export function hashExcerpt(text: string): Hex {
  return keccak256(stringToBytes(text));
}

/**
 * Length signed in `excerptLength`, in Unicode code points ("car." on the device), not UTF-16 units, so that an
 * emoji or an accented letter counts as one character, as a human reading the excerpt would count it.
 */
export function excerptLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Deterministic task identifier: keccak256(label || salt). The salt (32 random bytes chosen by the requester)
 * keeps two tasks with the same label distinct; it is fixed-size and last, so the packed encoding is unambiguous.
 */
export function taskIdFrom(label: string, salt: Hex): Hex {
  return keccak256(encodePacked(["string", "bytes32"], [label, salt]));
}
