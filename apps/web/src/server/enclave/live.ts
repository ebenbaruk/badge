/**
 * Live enclave (BADGE_ENCLAVE_MODE=live): to be wired by the integrator onto @badge/client.
 *
 * Wiring notes: one BadgeClient per employee, authenticated with `agentSessionAccount(employee)` from
 * `server/keys.ts` (the key the employee delegated with AgentSession); `attestation()` should verify the bundle
 * with @badge/attest (`verifyAttestation`) and map the result to `AttestationView`. Until then every method
 * rejects with a typed NotWiredError, which the UI shows as "Mode enclave réel pas encore branché".
 */
import { NotWiredError } from "../errors";
import type { EnclaveApi } from "./types";

type EnclaveMethod = Exclude<keyof EnclaveApi, "mode">;

const METHODS = [
  "attestation",
  "enrollment",
  "enroll",
  "openSession",
  "createTask",
  "getTask",
  "listTasks",
  "listConsents",
  "approveConsent",
  "rejectConsent",
  "listGrants",
  "revoke",
  "createPolicy",
  "listPolicies",
  "contextTags",
  "listDesks",
  "joinDesk",
  "createDeskRequest",
  "listDeskRequests",
  "approveDeskRequest",
  "rejectDeskRequest",
  "audit",
  "revealDeskShare",
] as const satisfies readonly EnclaveMethod[];

// Compile-time guard: adding a method to EnclaveApi without listing it here fails the build.
type MissingMethods = Exclude<EnclaveMethod, (typeof METHODS)[number]>;
const allMethodsListed: [MissingMethods] extends [never] ? true : false = true;
void allMethodsListed;

export function createLiveEnclave(): EnclaveApi {
  const notWired = (method: string) => (): Promise<never> => Promise.reject(new NotWiredError(method));
  const methods = Object.fromEntries(METHODS.map((method) => [method, notWired(method)]));
  // Every EnclaveApi method is present (checked above) and rejects; the cast only bridges Object.fromEntries.
  return { mode: "live", ...methods } as unknown as EnclaveApi;
}
