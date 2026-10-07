import type { Hex } from "viem";

/** The measurement every signed message must be pinned to (read once from dstack by the security layer). */
export interface EnclaveMeasurement {
  /** Compose hash of the running deployment as bytes32 (`enclaveMeasurementFrom`, @badge/attest). */
  readonly measurement: Hex;
}

/**
 * Rotates the data-encryption key of one owner's personal context (`KeyRotator` of src/security). Called on every
 * revocation, so that anything derived from the old key (caches, sealed copies) becomes unreadable.
 */
export interface OwnerKeyRotator {
  /** Moves the owner to a new key version and returns it. */
  rotate(employeeId: string): Promise<number>;
}
