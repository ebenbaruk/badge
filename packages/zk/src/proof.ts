/**
 * Desk membership proofs: "someone on desk X shares this excerpt for this request", without revealing who.
 *
 * Message and scope encoding (Semaphore v4.14.3, checked in @semaphore-protocol/proof):
 * - `generateProof` turns message and scope into bigints, then feeds the circuit `keccak256(toBeHex(v, 32)) >> 8`,
 *   which always fits the BN254 field. So a full bytes32 (excerptHash, requestId) is passed as-is, with no
 *   reduction and no loss: the proof carries the raw values and `verifyProof` re-hashes them the same way.
 * - Both are passed as bigints, never as strings: a non-numeric string is silently encoded as a left-aligned
 *   bytes32 text, a classic source of false rejects.
 * - The nullifier is Poseidon(hash(scope), secret): one per (member, requestId), unlinkable across requests.
 */
import { type Group, type Identity, generateProof, verifyProof } from "@semaphore-protocol/core";
import { type Hex, isHex, size } from "viem";
import { DESK_TREE_DEPTH, resolveDeskArtifacts } from "./artifacts";
import { ZkError } from "./errors";
import type { NullifierRegistry } from "./nullifiers";
import { type DeskProof, deskProofSchema } from "./wire";

const BYTES32 = 32;

function bytes32ToBigInt(value: Hex, field: string): bigint {
  if (!isHex(value, { strict: true }) || size(value) !== BYTES32) {
    throw new ZkError("INVALID_INPUT", `${field} must be a 32-byte hex string`);
  }
  return BigInt(value);
}

export interface CreateDeskProofInput {
  /** The sharer's identity, from `deriveDeskIdentity`. */
  identity: Identity;
  /** The sharer's desk group, built from the enclave's member list (`buildDeskGroup`). */
  group: Group;
  /** Hash of the shared excerpt (same value as `DeskShare.excerptHash`): bound as the Semaphore message. */
  excerptHash: Hex;
  /** Request the share answers (same value as `DeskShare.requestId`): the Semaphore scope, one share per member. */
  requestId: Hex;
  /** Directory of the depth-16 artifacts; defaults to `resolveDeskArtifacts()` resolution. */
  artifactsDir?: string;
}

/**
 * Proves that `identity` belongs to `group` and binds the proof to `excerptHash` and `requestId`.
 * Always uses {@link DESK_TREE_DEPTH} so the proof does not reveal the desk size. Takes about 1 s.
 *
 * @throws {ZkError} `INVALID_INPUT`, `NOT_A_MEMBER`, `ARTIFACTS_MISSING` or `PROOF_GENERATION_FAILED`.
 */
export async function createDeskProof(input: CreateDeskProofInput): Promise<DeskProof> {
  const message = bytes32ToBigInt(input.excerptHash, "excerptHash");
  const scope = bytes32ToBigInt(input.requestId, "requestId");
  // Checked here because Semaphore's own failure ("leaf at index -1") does not say what went wrong.
  if (input.group.indexOf(input.identity.commitment) === -1) {
    throw new ZkError("NOT_A_MEMBER", "the identity is not a member of this desk group");
  }
  const artifacts = resolveDeskArtifacts(input.artifactsDir);
  try {
    return await generateProof(input.identity, input.group, message, scope, DESK_TREE_DEPTH, artifacts);
  } catch (error) {
    throw new ZkError("PROOF_GENERATION_FAILED", `Semaphore proof generation failed: ${String(error)}`, {
      cause: error,
    });
  }
}

/** What the verifier expects the proof to be bound to; all three come from the enclave, never from the prover. */
export interface DeskProofExpectations {
  /** Root of the source desk's group the proof must be against (the enclave snapshots it per request). */
  expectedRoot: bigint;
  expectedExcerptHash: Hex;
  expectedRequestId: Hex;
}

/** Outcome of an accepted proof; the nullifier is what the compliance log records instead of the sharer. */
export interface VerifiedDeskProof {
  nullifier: bigint;
}

/**
 * Checks a desk proof without recording its nullifier: well-formed, at depth 16, for the expected desk root,
 * excerpt and request, and cryptographically valid. What a requester runs on a delivery, and what the enclave runs
 * before recording the nullifier in the same transaction as the delivery itself.
 *
 * The root check is not optional: `verifyProof` alone returns true for a valid proof from ANY group, including
 * another desk's. Cheap binding checks run first.
 *
 * @throws {ZkError} `INVALID_INPUT`, `MALFORMED_PROOF`, `WRONG_DEPTH`, `WRONG_ROOT`, `WRONG_MESSAGE`, `WRONG_SCOPE`
 * or `INVALID_PROOF`.
 */
export async function checkDeskProof(
  proof: DeskProof,
  expected: DeskProofExpectations,
): Promise<VerifiedDeskProof> {
  const expectedMessage = bytes32ToBigInt(expected.expectedExcerptHash, "expectedExcerptHash");
  const expectedScope = bytes32ToBigInt(expected.expectedRequestId, "expectedRequestId");

  // Re-validated even for typed callers: the proof may have been built from untrusted JSON without decodeDeskProof.
  const parsed = deskProofSchema.safeParse(proof);
  if (!parsed.success) {
    throw new ZkError("MALFORMED_PROOF", "proof does not match the wire schema", { cause: parsed.error });
  }
  const { merkleTreeDepth, merkleTreeRoot, message, scope, nullifier } = parsed.data;

  if (merkleTreeDepth !== DESK_TREE_DEPTH) {
    throw new ZkError(
      "WRONG_DEPTH",
      `proof depth is ${merkleTreeDepth}, desk proofs must use ${DESK_TREE_DEPTH}`,
    );
  }
  if (BigInt(merkleTreeRoot) !== expected.expectedRoot) {
    throw new ZkError("WRONG_ROOT", "proof is for another group than the expected desk");
  }
  if (BigInt(message) !== expectedMessage) {
    throw new ZkError("WRONG_MESSAGE", "proof is bound to another excerpt");
  }
  if (BigInt(scope) !== expectedScope) {
    throw new ZkError("WRONG_SCOPE", "proof is bound to another request");
  }

  let valid: boolean;
  try {
    valid = await verifyProof(proof);
  } catch (error) {
    throw new ZkError("MALFORMED_PROOF", `Semaphore rejected the proof structure: ${String(error)}`, {
      cause: error,
    });
  }
  if (!valid) {
    throw new ZkError("INVALID_PROOF", "Groth16 verification failed");
  }

  return { nullifier: BigInt(nullifier) };
}

/**
 * {@link checkDeskProof}, then records the nullifier: a member can share at most once per request. The nullifier is
 * consumed last so that an invalid proof can never burn a legitimate member's nullifier.
 *
 * @throws {ZkError} the codes of {@link checkDeskProof}, or `NULLIFIER_REUSED`.
 */
export async function verifyDeskProof(
  proof: DeskProof,
  expected: DeskProofExpectations,
  nullifiers: NullifierRegistry,
): Promise<VerifiedDeskProof> {
  const verified = await checkDeskProof(proof, expected);
  const scope = bytes32ToBigInt(expected.expectedRequestId, "expectedRequestId");
  if (!(await nullifiers.consume(scope, verified.nullifier))) {
    throw new ZkError("NULLIFIER_REUSED", "this member already shared for this request");
  }
  return verified;
}
