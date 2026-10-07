/**
 * Remembers which nullifiers were already accepted, per scope (request id).
 *
 * `consume` must be atomic (check and record in one step): with separate "has" and "add" calls, two concurrent
 * verifications of the same proof could both pass. A persistent implementation (the enclave's) must therefore use a
 * unique constraint or a transaction.
 */
export interface NullifierRegistry {
  /** Records `nullifier` for `scope`; resolves `false` if it was already recorded (nothing changes then). */
  consume(scope: bigint, nullifier: bigint): Promise<boolean>;
}

/** Process-local registry for tests and the single-process demo; state is lost on restart. */
export class InMemoryNullifierRegistry implements NullifierRegistry {
  readonly #used = new Map<bigint, Set<bigint>>();

  async consume(scope: bigint, nullifier: bigint): Promise<boolean> {
    let nullifiers = this.#used.get(scope);
    if (nullifiers === undefined) {
      nullifiers = new Set();
      this.#used.set(scope, nullifiers);
    }
    if (nullifiers.has(nullifier)) return false;
    nullifiers.add(nullifier);
    return true;
  }
}
