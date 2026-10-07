/**
 * Remembers authenticated requests for as long as their timestamp is acceptable, so each can be used only once.
 * Bounded: when full of still-valid entries it refuses new ones ("full") rather than evicting, because evicting a
 * live entry would make that request replayable again (fail closed).
 */
export type ReplayVerdict = "fresh" | "replay" | "full";

export class ReplayCache {
  /** key -> expiry (unix ms). Map iteration follows insertion order, roughly oldest first. */
  private readonly entries = new Map<string, number>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new RangeError("capacity must be a positive integer");
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Records `key` until `expiresAt` and says whether it was already seen.
   * @param now current unix ms; entries whose expiry has passed are forgotten.
   */
  checkAndRemember(key: string, expiresAt: number, now: number): ReplayVerdict {
    const known = this.entries.get(key);
    if (known !== undefined && known > now) return "replay";
    this.evictExpiredPrefix(now);
    if (this.entries.size >= this.capacity) {
      this.evictAllExpired(now);
      if (this.entries.size >= this.capacity) return "full";
    }
    this.entries.set(key, expiresAt);
    return "fresh";
  }

  /** Cheap amortised cleanup: insertion order approximates expiry order (timestamps are within a small window). */
  private evictExpiredPrefix(now: number): void {
    for (const [key, expiry] of this.entries) {
      if (expiry > now) return;
      this.entries.delete(key);
    }
  }

  private evictAllExpired(now: number): void {
    for (const [key, expiry] of this.entries) {
      if (expiry <= now) this.entries.delete(key);
    }
  }
}
