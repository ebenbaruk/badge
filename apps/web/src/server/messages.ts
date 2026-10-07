/**
 * Builders of the messages the employee's Ledger signs from the web app (pure; time and randomness injected or
 * drawn from Web Crypto). Every displayed string goes through `toDeviceAscii`: the device only renders ASCII.
 * Consent shares (ContextShare, DeskShare) are NOT built here: the enclave prepares them, the app only signs.
 */
import {
  createAgentSession,
  DEFAULT_AGENT_SESSION_TTL_SECONDS,
  type CreatedAgentSession,
} from "@badge/client";
import { toDeviceAscii, type ContextPolicy, type DeskJoin, type EmployeeEnroll } from "@badge/consent";
import type { Hex } from "viem";
import { COMPANY_NAME, type Employee } from "@/lib/directory";

const SECONDS_PER_DAY = 86_400n;
/**
 * A working day: the enclave caps sessions at 12 h (ENCLAVE_MAX_SESSION_TTL_SECONDS); staying under it leaves room
 * for clock drift between this bridge and the enclave.
 */
export const AGENT_SESSION_TTL_SECONDS = DEFAULT_AGENT_SESSION_TTL_SECONDS;
/** Standing agreements are capped at 90 days by @badge/consent (`MAX_POLICY_TTL_SECONDS`). */
export const MAX_POLICY_DAYS = 90;
const NONCE_BYTES = 16;
const AGENT_ACCESS = "Demandes uniquement";
/** Longest label we put on the device: the contract caps excerpt labels at 60 ASCII characters. */
export const MAX_DEVICE_LABEL_LENGTH = 60;
const FALLBACK_DEVICE_LABEL = "extrait";

/** Device ASCII, truncated to `max` and re-canonicalised (truncation may leave a trailing space). */
export function deviceLabel(text: string, max = MAX_DEVICE_LABEL_LENGTH): string {
  return toDeviceAscii(toDeviceAscii(text).slice(0, max)) || FALLBACK_DEVICE_LABEL;
}

/** 128 random bits: unguessable and never reused in practice; the enclave still rejects a replayed (signer, nonce). */
export function newNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

/** "Alice Martin (Ventes)": how a person is named on a device (ASCII). */
export function deviceName(employee: Pick<Employee, "name" | "team">): string {
  return toDeviceAscii(`${employee.name} (${employee.team})`);
}

export function buildEmployeeEnroll(
  employee: Employee,
  enclaveMeasurement: Hex,
  now: bigint,
  nonce: bigint = newNonce(),
): EmployeeEnroll {
  return {
    company: toDeviceAscii(COMPANY_NAME),
    employeeName: toDeviceAscii(employee.name),
    team: toDeviceAscii(employee.team),
    enclaveMeasurement,
    employee: employee.address,
    issuedAt: now,
    nonce,
  };
}

/**
 * A fresh agent session key and the AgentSession delegating to it (via @badge/client). The key must be kept by the
 * agent runtime only; the message is what the employee's Ledger signs.
 */
export function buildAgentSession(
  employee: Employee,
  enclaveMeasurement: Hex,
  now: Date = new Date(),
): CreatedAgentSession {
  return createAgentSession(employee.address, {
    agentName: `Agent Badge de ${employee.firstName}`,
    access: AGENT_ACCESS,
    enclaveMeasurement,
    ttlSeconds: AGENT_SESSION_TTL_SECONDS,
    now,
  });
}

export interface PolicyInput {
  granteeTeam: string;
  contextTag: string;
  purpose: string;
  maxExcerptLength: number;
  durationDays: number;
}

export function buildContextPolicy(
  owner: Employee,
  input: PolicyInput,
  enclaveMeasurement: Hex,
  now: bigint,
  nonce: bigint = newNonce(),
): ContextPolicy {
  return {
    granteeTeam: toDeviceAscii(input.granteeTeam),
    contextTag: toDeviceAscii(input.contextTag),
    purpose: toDeviceAscii(input.purpose),
    maxExcerptLength: input.maxExcerptLength,
    expiresAt: now + BigInt(input.durationDays) * SECONDS_PER_DAY,
    enclaveMeasurement,
    owner: owner.address,
    nonce,
  };
}

export function buildDeskJoin(
  employee: Employee,
  deskName: string,
  identityCommitment: bigint,
  nonce: bigint = newNonce(),
): DeskJoin {
  return {
    deskName: toDeviceAscii(deskName),
    company: toDeviceAscii(COMPANY_NAME),
    identityCommitment,
    employee: employee.address,
    nonce,
  };
}
