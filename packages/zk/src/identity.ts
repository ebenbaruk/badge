import { Identity } from "@semaphore-protocol/core";
import { type Hex, hexToBytes, isHex, keccak256, size } from "viem";
import { ZkError } from "./errors";

/** r (32) + s (32) + v (1): the only signature shape a Ledger returns for EIP-191. */
const ECDSA_SIGNATURE_BYTES = 65;

/**
 * Derives the employee's anonymous desk identity from their Ledger signature of `deskIdentityDeriveMessage`
 * (from `@badge/consent`). The Semaphore private key is the 32 raw bytes of keccak256(signature).
 *
 * Why this works without storing anything: Ledger ECDSA signatures are deterministic (RFC 6979), so the same
 * Ledger re-derives the same identity on demand, and only the Ledger holder can. The secret is fed as bytes, not
 * as a hex string, because Semaphore hashes a string private key as UTF-8 text.
 *
 * @throws {ZkError} `INVALID_SIGNATURE` when `signature` is not a 65-byte hex string.
 */
export function deriveDeskIdentity(signature: Hex): Identity {
  if (!isHex(signature, { strict: true }) || size(signature) !== ECDSA_SIGNATURE_BYTES) {
    throw new ZkError("INVALID_SIGNATURE", `expected a ${ECDSA_SIGNATURE_BYTES}-byte hex signature`);
  }
  return new Identity(hexToBytes(keccak256(signature)));
}
