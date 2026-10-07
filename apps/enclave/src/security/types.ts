/**
 * Types shared by the authentication middleware (src/security) and the HTTP routes (src/api). Kept in one tiny
 * file so both sides agree on what an authenticated request carries without depending on each other.
 */
import type { Address } from "viem";

/** The employee on whose behalf an authenticated request runs (resolved from a valid agent session). */
export interface Caller {
  /** Directory id (alice, bob, chloe...). */
  readonly employeeId: string;
  /** The employee's Ledger address (the one that signs consents). */
  readonly address: Address;
  /** The agent session key that signed the request. */
  readonly sessionKey: Address;
}

/** Hono environment of the enclave app: `c.get("caller")` is set by the authentication middleware. */
export type BadgeEnv = {
  Variables: {
    caller: Caller;
  };
};
