import { randomBytes } from "node:crypto";
import { bytesToHex, type Hex } from "viem";

const BYTES32 = 32;

/** 32 random bytes as lower-case hex: request ids, task salts. Unguessable, so ids double as capabilities. */
export function randomBytes32(): Hex {
  return bytesToHex(randomBytes(BYTES32));
}

/** A random uint256 nonce for a message the enclave prepares for signature. */
export function randomNonce(): bigint {
  return BigInt(randomBytes32());
}
