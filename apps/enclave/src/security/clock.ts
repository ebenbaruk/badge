/** Source of time, injected so that freshness checks are testable. */
export interface Clock {
  /** Unix milliseconds. */
  now(): number;
}

/** The machine clock (inside a CVM: the TD's clock, synchronised by the dstack guest). */
export const systemClock: Clock = { now: () => Date.now() };
