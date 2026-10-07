import type { Address } from "viem";

export type Caller = { employeeId: string; address: Address; sessionKey: Address };
export type BadgeEnv = { Variables: { caller: Caller } };
