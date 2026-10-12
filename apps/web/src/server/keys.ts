/**
 * Per-employee secrets held by the agent runtime in process memory (never logged):
 * - the key of the agent session being delegated (software secp256k1), until the AgentSession signed on the
 *   employee's Ledger is registered; the live enclave then persists it with the session (agent-store.ts);
 * - the desk identity, re-derived from a Ledger signature (deterministic, RFC 6979), cached so that an anonymous
 *   share needs one device review (the DeskShare) instead of two.
 */
import { deskIdentityDeriveMessage } from "@badge/consent";
import { deriveDeskIdentity, type Identity } from "@badge/zk";
import type { Hex, LocalAccount } from "viem";
import { COMPANY_NAME, type EmployeeId } from "@/lib/directory";
import { signPersonalOnDevice } from "./signing";

/** A session key and its account (the private key is what the runtime persists once the session is open). */
export interface AgentSessionKey {
  readonly privateKey: Hex;
  readonly account: LocalAccount;
}

interface KeyStore {
  agentKeys: Map<EmployeeId, AgentSessionKey>;
  deskIdentities: Map<EmployeeId, Identity>;
}

// globalThis: survives dev hot reloads, so a session delegated on the device stays usable.
const STORE_KEY = Symbol.for("badge.web.keys");
const globalStore = globalThis as typeof globalThis & { [STORE_KEY]?: KeyStore };
const store: KeyStore = (globalStore[STORE_KEY] ??= { agentKeys: new Map(), deskIdentities: new Map() });

/** The key of the employee's latest delegation, if any. */
export function agentSessionKey(employee: EmployeeId): AgentSessionKey | undefined {
  return store.agentKeys.get(employee);
}

/**
 * Adopts the key of a new delegation, just before its AgentSession is signed: a new signature never revalidates an
 * old key. The previous session stays usable by the enclave client until the new one is registered.
 */
export function adoptAgentSessionKey(employee: EmployeeId, key: AgentSessionKey): void {
  store.agentKeys.set(employee, key);
}

/**
 * The employee's anonymous desk identity. Derived from a personal-message signature on their device the first
 * time (one device review), then cached for the life of the process.
 */
export async function deskIdentity(employee: EmployeeId): Promise<Identity> {
  const cached = store.deskIdentities.get(employee);
  if (cached !== undefined) return cached;
  const signature = await signPersonalOnDevice(employee, deskIdentityDeriveMessage(COMPANY_NAME));
  const identity = deriveDeskIdentity(signature);
  store.deskIdentities.set(employee, identity);
  return identity;
}
