/**
 * In-memory state of the mock enclave, and the small helpers every mock module shares (time, ids, nonces,
 * signature verification). Process-local by design: a restart resets the demo.
 */
import {
  toUnixSeconds,
  verifyBadgeSignature,
  type BadgeMessageKind,
  type BadgeMessages,
  type ContextPolicy,
  type ContextShare,
  type DeskShare,
  type SignedMessage,
} from "@badge/consent";
import type { SealedBox } from "@badge/attest";
import { InMemoryNullifierRegistry } from "@badge/zk";
import { bytesToHex, keccak256, toHex, type Address, type Hex } from "viem";
import { EMPLOYEES, type DeskId, type EmployeeId } from "@/lib/directory";
import { EnclaveError } from "../errors";
import type {
  BlockedExcerptView,
  BriefView,
  PendingExcerptView,
  RequestStatus,
  RuleFinding,
  SourceView,
  TaskStep,
} from "../enclave/types";
import { AuditLog } from "./audit";
import { loadSeed, type SeedData, type SeedNote } from "./seed";

/** A source of a task, with the notes it bundles (needed to draft the brief and to count tokens). */
export interface TaskSource extends SourceView {
  /** Excerpt text (mock only: the live enclave never discloses it outside the brief). */
  text: string;
  noteIds: string[];
  noteTexts: string[];
}

export interface TaskRecord {
  id: Hex;
  requester: EmployeeId;
  task: string;
  taskLabel: string;
  createdAt: Date;
  trapped: boolean;
  steps: TaskStep[];
  allowed: TaskSource[];
  pending: PendingExcerptView[];
  blocked: BlockedExcerptView[];
  brief?: BriefView;
}

export interface ConsentRecord {
  id: string;
  taskId: Hex;
  owner: EmployeeId;
  requester: EmployeeId;
  task: string;
  createdAt: Date;
  status: RequestStatus;
  findings: RuleFinding[];
  message: ContextShare;
  label: string;
  notes: SeedNote[];
  /** The exact text the consent binds (by hash and length). Stays in the enclave until approved. */
  excerptText: string;
}

export interface GrantRecord {
  id: Hex;
  owner: EmployeeId;
  recipient: EmployeeId;
  label: string;
  taskLabel: string;
  excerptHash: Hex;
  createdAt: Date;
  expiresAt: bigint;
  uses: number;
  revokedAt?: Date;
}

export interface PolicyRecord {
  id: Hex;
  owner: EmployeeId;
  policy: ContextPolicy;
  createdAt: Date;
  uses: number;
  revokedAt?: Date;
}

export interface DeskRequestRecord {
  id: Hex;
  requester: EmployeeId;
  owner: EmployeeId;
  fromDesk: DeskId;
  toDesk: DeskId;
  task: string;
  ruleLabel: string;
  createdAt: Date;
  status: RequestStatus | "delivered";
  note: SeedNote;
  message: DeskShare;
  delivery?: { nullifier: string; root: string; deliveredAt: Date };
}

export interface SealedRecord {
  seq: number;
  ts: Date;
  sourceDesk: DeskId;
  label: string;
  sealed: SealedBox;
  /** The sharer, known to the enclave only (the real one seals it to the compliance X25519 key). */
  signer: EmployeeId;
  revealedAt?: Date;
}

export interface MockState {
  measurement: Hex;
  seed: SeedData;
  audit: AuditLog;
  usedNonces: Set<string>;
  enrollments: Map<EmployeeId, Date>;
  sessions: Map<EmployeeId, { sessionKey: Address; agentName: string; expiresAt: bigint }>;
  tasks: Map<Hex, TaskRecord>;
  consents: Map<string, ConsentRecord>;
  grants: Map<Hex, GrantRecord>;
  policies: Map<Hex, PolicyRecord>;
  /** Owner -> timestamps (ms) of cross-owner requests, for the per-hour rule. */
  requestLog: Map<EmployeeId, number[]>;
  deskCommitments: Map<DeskId, bigint[]>;
  deskJoined: Map<EmployeeId, Set<DeskId>>;
  deskRequests: Map<Hex, DeskRequestRecord>;
  nullifiers: InMemoryNullifierRegistry;
  sealed: Map<number, SealedRecord>;
  /** Compliance officer's X25519 public key (hex), registered from her Ledger; desk shares are sealed to it. */
  complianceKey?: { publicKey: string; registeredAt: Date };
}

const RANDOM_ID_BYTES = 32;

export function randomBytes32(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(RANDOM_ID_BYTES)));
}

export function nowSeconds(): bigint {
  return toUnixSeconds(new Date());
}

export function secondsToIso(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString();
}

/** Default measurement of the mock enclave: a fixed, recognisable placeholder for the compose hash. */
export function mockMeasurement(override?: Hex): Hex {
  return override ?? keccak256(toHex("badge/mock-enclave/v1"));
}

export function createMockState(measurement: Hex, deskCommitments: Map<DeskId, bigint[]>): MockState {
  return {
    measurement,
    seed: loadSeed(),
    audit: new AuditLog(),
    usedNonces: new Set(),
    enrollments: new Map(),
    sessions: new Map(),
    tasks: new Map(),
    consents: new Map(),
    grants: new Map(),
    policies: new Map(),
    requestLog: new Map(),
    deskCommitments,
    deskJoined: new Map(),
    deskRequests: new Map(),
    nullifiers: new InMemoryNullifierRegistry(),
    sealed: new Map(),
  };
}

/** Rejects a replayed (signer, nonce) pair, then records it (fail closed: checked before any state change). */
export function consumeNonce(state: MockState, signer: Address, nonce: bigint): void {
  const key = `${signer.toLowerCase()}:${nonce}`;
  if (state.usedNonces.has(key)) throw new EnclaveError("CONFLICT", "nonce already used (replay refused)");
  state.usedNonces.add(key);
}

/** Verifies a Ledger signature by `employee`'s directory address (throws a ConsentError otherwise). */
export async function verifySignedBy<K extends BadgeMessageKind>(
  signed: SignedMessage<K>,
  employee: EmployeeId,
): Promise<BadgeMessages[K]> {
  await verifyBadgeSignature(signed.kind, signed.message, signed.signature, EMPLOYEES[employee].address);
  return signed.message;
}

export function employeeByAddress(address: Address): EmployeeId {
  const match = Object.values(EMPLOYEES).find((e) => e.address.toLowerCase() === address.toLowerCase());
  if (match === undefined) throw new EnclaveError("FORBIDDEN", `address ${address} is not in the directory`);
  return match.id;
}

export function addStep(task: TaskRecord, step: Omit<TaskStep, "at">): void {
  task.steps.push({ ...step, at: new Date().toISOString() });
}
