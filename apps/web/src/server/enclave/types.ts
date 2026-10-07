/**
 * The web app's view of the enclave API (docs/enclave-api.md). Every method acts "as" one employee: in live mode
 * the call is authenticated with that employee's agent session key; in mock mode the id is trusted.
 *
 * View types are plain JSON (ISO dates, decimal strings for bigints, wire-format messages) so they cross the
 * server/client boundary of React Server Components unchanged. Client components import them with `import type`.
 */
import type { SignedMessage, WireMessage } from "@badge/consent";
import type { DeskProofWire } from "@badge/zk";
import type { Address, Hex } from "viem";
import type { DeskId, EmployeeId } from "@/lib/directory";

export type EnclaveMode = "mock" | "live";

/** Owner of a piece of context: the company (global context) or one employee (personal context). */
export type ContextOwner = EmployeeId | "company";

/** How an excerpt was allowed into a task (shown as the source's provenance). */
export type AllowedBy = "global" | "own" | "consent" | "grant" | "policy";

export interface AttestationView {
  /** `tdx`: real Intel TDX quote verified; `simulated`: dstack simulator or mock, NOT a real TEE. */
  mode: "tdx" | "simulated";
  verified: boolean;
  /** Compose hash as bytes32: the enclave measurement every signed message is pinned to. */
  measurement: Hex;
  tcbStatus: string;
  appId: string;
  /** Relaxed checks or advisories worth showing to a reviewer. */
  warnings: string[];
  checkedAt: string;
}

export interface EnrollmentView {
  enrolled: boolean;
  enrolledAt?: string;
  session?: { sessionKey: Address; agentName: string; expiresAt: string };
}

export interface CreateTaskInput {
  task: string;
  /** Short ASCII label shown on the owner's device ("brief Orion"). */
  taskLabel: string;
  /**
   * Demo of a prompt-injected agent: instead of a task-scoped search, it asks for the whole personal context of
   * an employee. The enclave's deterministic rules must flag it.
   */
  trap?: { requestFullContextOf: EmployeeId };
}

export type RuleOutcome = "ok" | "warn" | "block";

export interface RuleFinding {
  /** Stable rule id (e.g. `owner-share`), logged in the audit. */
  rule: string;
  outcome: Exclude<RuleOutcome, "ok">;
  message: string;
}

export interface SourceView {
  /** Stable id of the excerpt within the task. */
  id: string;
  owner: ContextOwner;
  label: string;
  length: number;
  allowedBy: AllowedBy;
  /** Excerpt text, only for allowed sources (it already reached the requester's brief). */
  text: string;
}

export interface PendingExcerptView {
  consentId: string;
  owner: EmployeeId;
  label: string;
  length: number;
  findings: RuleFinding[];
}

export interface BlockedExcerptView {
  owner: ContextOwner;
  label: string;
  length: number;
  /** Why it never reached the owner: rule blocks, classifier exclusions, refusals. */
  reason: string;
  kind: "rule" | "classifier" | "rejected" | "revoked";
}

export type TaskStepKind =
  | "search"
  | "candidates"
  | "classified"
  | "allowed"
  | "policy"
  | "waiting_consent"
  | "consent_received"
  | "consent_rejected"
  | "rule_warn"
  | "rule_block"
  | "brief"
  | "refused";

export interface TaskStep {
  kind: TaskStepKind;
  at: string;
  title: string;
  detail?: string;
}

export interface BriefView {
  title: string;
  bullets: Array<{ text: string; sourceIds: string[] }>;
  recommendation?: string;
}

export interface TokenStats {
  selectedTokens: number;
  allContextTokens: number;
}

export type TaskStatus = "waiting_consent" | "ready" | "refused";

export interface TaskView {
  id: Hex;
  requester: EmployeeId;
  task: string;
  taskLabel: string;
  createdAt: string;
  status: TaskStatus;
  trapped: boolean;
  steps: TaskStep[];
  allowed: SourceView[];
  pending: PendingExcerptView[];
  blocked: BlockedExcerptView[];
  brief?: BriefView;
  tokenStats?: TokenStats;
}

export type RequestStatus = "pending" | "approved" | "rejected" | "expired";

export interface ConsentRequestView {
  id: string;
  taskId: Hex;
  owner: EmployeeId;
  requester: EmployeeId;
  task: string;
  createdAt: string;
  status: RequestStatus;
  findings: RuleFinding[];
  /** Exact ContextShare prepared by the enclave: what the owner's Ledger will display and sign. */
  message: WireMessage<"ContextShare">;
  /** Notes bundled in the excerpt (labels only: the owner already knows their own notes). */
  noteLabels: string[];
}

export type GrantKind = "share" | "policy";

export interface GrantView {
  id: Hex;
  kind: GrantKind;
  owner: EmployeeId;
  /** Recipient employee (share) or grantee team (policy). */
  recipientLabel: string;
  recipient?: EmployeeId;
  label: string;
  createdAt: string;
  expiresAt: string;
  uses: number;
  revokedAt?: string;
}

export interface PolicyView {
  id: Hex;
  owner: EmployeeId;
  granteeTeam: string;
  contextTag: string;
  purpose: string;
  maxExcerptLength: number;
  createdAt: string;
  expiresAt: string;
  uses: number;
  revokedAt?: string;
}

export interface DeskView {
  id: DeskId;
  name: string;
  /** Directory members (count only: who registered an identity is not revealed). */
  directoryMembers: number;
  /** Registered anonymous identities, in registration order (decimal strings): needed to build proofs. */
  commitments: string[];
  /** Semaphore group root (decimal) or null for an empty desk. */
  root: string | null;
  /** Whether the viewer belongs to this desk in the directory, and has registered their identity. */
  isMember: boolean;
  joined: boolean;
  allowedTopics: string[];
  /** An exchange rule lets one of the viewer's desks request from this desk. */
  requestable: boolean;
}

export interface DeskRequestView {
  id: Hex;
  fromDesk: DeskId;
  toDesk: DeskId;
  task: string;
  ruleLabel: string;
  createdAt: string;
  status: RequestStatus | "delivered";
  /** Present once delivered: the excerpt and the proof facts, never the sharer. */
  delivery?: {
    excerpt: string;
    label: string;
    sourceDesk: DeskId;
    nullifier: string;
    root: string;
    deliveredAt: string;
  };
}

export interface DeskConsentView {
  id: Hex;
  owner: EmployeeId;
  fromDesk: DeskId;
  task: string;
  createdAt: string;
  status: RequestStatus;
  message: WireMessage<"DeskShare">;
}

export interface AuditEntryView {
  seq: number;
  ts: string;
  type: string;
  actor: string;
  subject: string;
  data: Record<string, unknown>;
  prevHash: Hex;
  hash: Hex;
}

export interface ChainVerification {
  ok: boolean;
  length: number;
  headHash: Hex;
  /** First entry whose hash does not match, when `ok` is false. */
  brokenAt?: number;
}

export interface SealedIdentityView {
  seq: number;
  ts: string;
  sourceDesk: DeskId;
  label: string;
  /** Ciphertext sealed to the compliance key (opaque to the web server). */
  sealed: string;
  revealed?: { employee: EmployeeId; revealedAt: string };
}

export interface AuditView {
  entries: AuditEntryView[];
  chain: ChainVerification;
  alerts: AuditEntryView[];
  sealed: SealedIdentityView[];
}

export interface DeskRequestsView {
  /** Requests addressed to the viewer as a member of the source desk (to approve anonymously). */
  incoming: DeskConsentView[];
  /** Requests the viewer's desk made, with anonymous deliveries. */
  outgoing: DeskRequestView[];
}

/** The enclave API as used by the web app. Implemented by the mock (demo) and, later, by @badge/client. */
export interface EnclaveApi {
  readonly mode: EnclaveMode;
  attestation(): Promise<AttestationView>;

  enrollment(employee: EmployeeId): Promise<EnrollmentView>;
  enroll(signed: SignedMessage<"EmployeeEnroll">): Promise<EnrollmentView>;
  openSession(employee: EmployeeId, signed: SignedMessage<"AgentSession">): Promise<EnrollmentView>;

  createTask(requester: EmployeeId, input: CreateTaskInput): Promise<TaskView>;
  getTask(requester: EmployeeId, taskId: Hex): Promise<TaskView>;
  listTasks(requester: EmployeeId): Promise<TaskView[]>;

  listConsents(owner: EmployeeId): Promise<ConsentRequestView[]>;
  approveConsent(owner: EmployeeId, consentId: string, signature: Hex): Promise<void>;
  rejectConsent(owner: EmployeeId, consentId: string): Promise<void>;

  listGrants(owner: EmployeeId): Promise<GrantView[]>;
  revoke(owner: EmployeeId, signed: SignedMessage<"ContextRevoke">): Promise<{ revoked: number }>;

  createPolicy(owner: EmployeeId, signed: SignedMessage<"ContextPolicy">): Promise<PolicyView>;
  listPolicies(owner: EmployeeId): Promise<PolicyView[]>;
  /** Tags of the owner's own notes, to offer in the standing-agreement form. */
  contextTags(owner: EmployeeId): Promise<string[]>;

  listDesks(viewer: EmployeeId): Promise<DeskView[]>;
  joinDesk(employee: EmployeeId, signed: SignedMessage<"DeskJoin">): Promise<DeskView>;
  createDeskRequest(
    requester: EmployeeId,
    input: { fromDesk: DeskId; toDesk: DeskId; task: string },
  ): Promise<DeskRequestView>;
  listDeskRequests(viewer: EmployeeId): Promise<DeskRequestsView>;
  approveDeskRequest(
    owner: EmployeeId,
    requestId: Hex,
    signed: SignedMessage<"DeskShare">,
    proof: DeskProofWire,
  ): Promise<void>;
  rejectDeskRequest(owner: EmployeeId, requestId: Hex): Promise<void>;

  /** Compliance role only. */
  audit(viewer: EmployeeId): Promise<AuditView>;
  /** Compliance role only. Mock: decrypts in place; live: client-side decryption, then a reveal notice. */
  revealDeskShare(viewer: EmployeeId, seq: number): Promise<SealedIdentityView>;
}
