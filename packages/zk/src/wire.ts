import type { SemaphoreProof } from "@semaphore-protocol/core";
import { z } from "zod";
import { ZkError } from "./errors";

/** A desk membership proof as produced by Semaphore v4: every big number is a canonical decimal string. */
export type DeskProof = SemaphoreProof;

const UINT256_LIMIT = 2n ** 256n;
const GROTH16_PACKED_POINTS = 8;
const MAX_SEMAPHORE_DEPTH = 32;

/**
 * Canonical decimal (no sign, no leading zero, no hex) below 2^256. Canonical form matters: the verifier compares
 * these strings' values to expected ones and Semaphore re-encodes them as 32-byte words, which throws above 2^256.
 */
const uint256Decimal = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "expected a canonical decimal integer")
  .refine((value) => BigInt(value) < UINT256_LIMIT, "exceeds 2^256 - 1");

/** Wire format of a desk proof (JSON-safe, bigints as decimal strings). Depth is range-checked here, pinned later. */
export const deskProofSchema = z.strictObject({
  merkleTreeDepth: z.number().int().min(1).max(MAX_SEMAPHORE_DEPTH),
  merkleTreeRoot: uint256Decimal,
  nullifier: uint256Decimal,
  message: uint256Decimal,
  scope: uint256Decimal,
  points: z.array(uint256Decimal).length(GROTH16_PACKED_POINTS),
});

export type DeskProofWire = z.infer<typeof deskProofSchema>;

/** Serializes a desk proof to its wire format (a plain JSON-safe object). */
export function encodeDeskProof(proof: DeskProof): DeskProofWire {
  return {
    merkleTreeDepth: proof.merkleTreeDepth,
    merkleTreeRoot: proof.merkleTreeRoot,
    nullifier: proof.nullifier,
    message: proof.message,
    scope: proof.scope,
    points: [...proof.points],
  };
}

/**
 * Parses an untrusted wire value (e.g. a parsed JSON body) into a desk proof. Only checks the shape: the proof still
 * has to go through `verifyDeskProof`.
 *
 * @throws {ZkError} `MALFORMED_PROOF` with the zod issues in the message.
 */
export function decodeDeskProof(input: unknown): DeskProof {
  const parsed = deskProofSchema.safeParse(input);
  if (!parsed.success) {
    throw new ZkError("MALFORMED_PROOF", z.prettifyError(parsed.error), { cause: parsed.error });
  }
  // The schema checks digits and bounds, which is exactly what snarkjs' NumericString brand and the 8-tuple promise.
  return parsed.data as DeskProof;
}
