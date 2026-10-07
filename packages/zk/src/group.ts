import { Group } from "@semaphore-protocol/core";
import { ZkError } from "./errors";

/** BN254 scalar field order: identity commitments are Poseidon outputs, hence always below it. */
export const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Builds a desk's Semaphore group from its members' identity commitments (order matters: it fixes the root, so the
 * enclave must keep the registration order).
 *
 * @throws {ZkError} `INVALID_GROUP` on an empty list, a duplicate, or a value that is not a field element.
 */
export function buildDeskGroup(commitments: readonly bigint[]): Group {
  if (commitments.length === 0) {
    throw new ZkError("INVALID_GROUP", "a desk group needs at least one member");
  }
  const seen = new Set<bigint>();
  for (const commitment of commitments) {
    if (commitment <= 0n || commitment >= SNARK_SCALAR_FIELD) {
      throw new ZkError("INVALID_GROUP", `commitment ${commitment} is not a non-zero field element`);
    }
    // A duplicate would make two leaves prove the same member; it always signals a registration bug.
    if (seen.has(commitment)) {
      throw new ZkError("INVALID_GROUP", `duplicate commitment ${commitment}`);
    }
    seen.add(commitment);
  }
  return new Group([...commitments]);
}

/**
 * Merkle root of a desk group: the value a verifier pins as `expectedRoot`.
 *
 * @throws {ZkError} `INVALID_GROUP` (see {@link buildDeskGroup}).
 */
export function deskGroupRoot(commitments: readonly bigint[]): bigint {
  return buildDeskGroup(commitments).root;
}
