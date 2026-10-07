import type { Address } from "viem";
import { EnclaveError } from "../errors";
import { isUniqueViolation, type Database } from "./database";

/**
 * Nonces of every signed message the enclave accepted, per signer. A nonce is consumed in the same transaction as
 * the effect it authorizes, so a replayed message is refused even if it is otherwise still valid.
 */
export class NonceRepository {
  constructor(private readonly db: Database) {}

  /** True when `signer` already used `nonce` (read-only pre-check before an expensive step). */
  isUsed(signer: Address, nonce: bigint): boolean {
    const row = this.db
      .prepare("SELECT 1 AS used FROM used_nonces WHERE signer = ? AND nonce = ?")
      .get(signer.toLowerCase(), nonce.toString(10));
    return row !== undefined;
  }

  /**
   * Records `nonce` for `signer`. Call inside the transaction that applies the message.
   * @throws {EnclaveError} NONCE_REUSED when it was already used.
   */
  consume(signer: Address, nonce: bigint, kind: string, nowMs: number): void {
    try {
      this.db
        .prepare("INSERT INTO used_nonces (signer, nonce, kind, used_ms) VALUES (?, ?, ?, ?)")
        .run(signer.toLowerCase(), nonce.toString(10), kind, nowMs);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EnclaveError("NONCE_REUSED", `nonce ${nonce} of ${signer} was already used`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}
