/**
 * Per-employee secrets held by the agent runtime (process memory only, never persisted or logged):
 * - the agent session key (software secp256k1), delegated by the employee's Ledger with an AgentSession;
 * - the desk identity, re-derived from a Ledger signature (deterministic, RFC 6979), cached so that an anonymous
 *   share needs one device review (the DeskShare) instead of two.
 */
import { deskIdentityDeriveMessage } from "@badge/consent";
import { deriveDeskIdentity, type Identity } from "@badge/zk";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { COMPANY_NAME, type EmployeeId } from "@/lib/directory";
import { signPersonalOnDevice } from "./signing";

interface KeyStore {
  agentKeys: Map<EmployeeId, PrivateKeyAccount>;
  deskIdentities: Map<EmployeeId, Identity>;
}

// globalThis: survives dev hot reloads, so a session delegated on the device stays usable.
const STORE_KEY = Symbol.for("badge.web.keys");
const globalStore = globalThis as typeof globalThis & { [STORE_KEY]?: KeyStore };
const store: KeyStore = (globalStore[STORE_KEY] ??= { agentKeys: new Map(), deskIdentities: new Map() });

/** The agent's session key for `employee`, created on first use. */
export function agentSessionAccount(employee: EmployeeId): PrivateKeyAccount {
  let account = store.agentKeys.get(employee);
  if (account === undefined) {
    account = privateKeyToAccount(generatePrivateKey());
    store.agentKeys.set(employee, account);
  }
  return account;
}

/** Replaces the session key (a new AgentSession is about to be signed, the old key must not be reused). */
export function rotateAgentSessionAccount(employee: EmployeeId): PrivateKeyAccount {
  store.agentKeys.delete(employee);
  return agentSessionAccount(employee);
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

/** Cached identity only (never prompts the device). */
export function cachedDeskIdentity(employee: EmployeeId): Identity | undefined {
  return store.deskIdentities.get(employee);
}
