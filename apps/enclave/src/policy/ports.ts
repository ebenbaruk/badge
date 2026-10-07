import type { Hex } from "viem";

/** What the enclave knows about itself: the measurement every signed message must be pinned to. */
export interface EnclaveIdentity {
  /** Compose hash of the running deployment as bytes32 (`enclaveMeasurementFrom`, @badge/attest). */
  readonly measurement: Hex;
}

/**
 * Rotates the data-encryption key of one owner's personal context (keys module, src/security). Called on every
 * revocation, so that anything derived from the old key (caches, sealed copies) becomes unreadable.
 */
export interface KeyRotator {
  rotateOwnerKey(employeeId: string): Promise<void>;
}
