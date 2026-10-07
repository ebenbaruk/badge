import { toUnixSeconds } from "@badge/consent";

/** Source of the current time, injected everywhere so expiry rules are testable with a fixed clock. */
export interface Clock {
  now(): Date;
}

/** The wall clock. */
export const systemClock: Clock = { now: () => new Date() };

/** Current time in unix seconds, the unit of every `expiresAt` / `issuedAt` field of signed messages. */
export function nowSeconds(clock: Clock): bigint {
  return toUnixSeconds(clock.now());
}

/** Converts unix seconds (from a signed message, already range-checked) to unix milliseconds. */
export function secondsToMs(seconds: bigint): number {
  return Number(seconds) * 1000;
}

/** Unix milliseconds (storage) to the unix seconds of the API responses. */
export function msToUnixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}
