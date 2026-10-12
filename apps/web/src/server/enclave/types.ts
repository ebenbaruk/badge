/**
 * The web app's view of the enclave API (docs/enclave-api.md). Every method acts "as" one employee: in live mode
 * the call is authenticated with that employee's agent session key; in mock mode the id is trusted.
 *
 * View types are plain JSON (ISO dates, decimal strings for bigints, wire-format messages) so they cross the
 * server/client boundary of React Server Components unchanged. Client components import them with `import type`.
 */
import type { ContextRevoke, SignedMessage, WireMessage } from "@badge/consent";
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
  /** Key provider of the CVM (`kms`, `local`...), when the event log names one. */
  keyProvider?: string;
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
  /** Compliance role only: the X25519 public key registered for de-anonymisation (derived from the Ledger). */
  complianceKey?: { publicKey: string; registeredAt: string };
}

/** Body of a compliance key registration (contract flow 9). */
export interface ComplianceKeyInput {
  /** X25519 public key, lowercase hex without prefix. */
  publicKey: string;
  /** EIP-191 Ledger signature of `complianceKeyRegistrationMessage(company, publicKey)`. */
  signature: Hex;
}

/** A de-anonymisation done on the compliance officer's side, to be logged by the enclave. */
export interface RevealNoticeInput {
  seq: number;
  reason: string;
  /**
   * Who the sealed identity named, as decrypted by the officer's device bridge. Kept in the bridge's memory to show
   * the result; never sent to the enclave (the notice only says that entry `seq` was opened, and why).
   */
  signer: EmployeeId;
}

export interface CreateTaskInput {
  task: string;
  /** Short ASCII label shown on the owner's device ("Morpho meeting brief"). */
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
  /** Why it is not used: rule blocks, classifier exclusions, refusals, revocations, expiries. */
  reason: string;
  kind: "rule" | "classifier" | "rejected" | "revoked" | "expired";
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
  /** When the enclave reports it (the live API only timestamps the task itself). */
  at?: string;
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
  /** The task as the owner's device shows it ("Task"). */
  taskLabel: string;
  createdAt: string;
  status: RequestStatus;
  findings: RuleFinding[];
  /** Exact ContextShare prepared by the enclave: what the owner's Ledger will display and sign. */
  message: WireMessage<"ContextShare">;
  /** The owner's own text that would leave their scope, and its tags (shown to the owner only). */
  excerpt: { text: string; tags: string[] };
}

/**
 * A decided consent request, as the owner's history lists it. Deliberately without the excerpt text nor the signed
 * message: it is kept by the agent runtime (on disk, across restarts) and must not hold the owner's context.
 */
export interface ConsentHistoryView {
  id: string;
  requester: EmployeeId;
  /** The excerpt label the owner's Ledger showed (device ASCII). */
  excerptLabel: string;
  /** The enclave's rules flagged the request. */
  flagged: boolean;
  status: Exclude<RequestStatus, "pending">;
  createdAt: string;
}

export type GrantKind = "share" | "policy";

export type AgreementStatus = "active" | "revoked" | "expired";

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
  /** Logged uses (standing agreements; a one-off grant covers one excerpt). */
  uses?: number;
  status: AgreementStatus;
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
  status: AgreementStatus;
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
  /**
   * An exchange rule lets another desk ask this desk's members for context, anonymously: only then does the group
   * need its anonymity set (3 Ledger-joined members). A desk that only receives (Origination) never needs it.
   */
  askedAnonymously: boolean;
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
  /** `no_match`: no member of the source desk holds an excerpt the rule allows. */
  status: RequestStatus | "delivered" | "no_match";
  /** Present once delivered: the excerpt and the facts of its verified ZK proof, never the sharer. */
  delivery?: {
    excerpt: string;
    sourceDesk: DeskId;
    nullifier: string;
    root: string;
    /**
     * Checked on the requester's side: the excerpt hashes to the proven message, and the Semaphore proof is against
     * the source desk's group snapshotted with the request.
     */
    proofVerified: boolean;
    /** Absent when the enclave does not timestamp deliveries (live). */
    deliveredAt?: string;
  };
}

export interface DeskConsentView {
  id: Hex;
  owner: EmployeeId;
  fromDesk: DeskId;
  /** The exchange rule the request is made under (the requester's identity is never disclosed). */
  ruleLabel: string;
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
  prevHash: string;
  hash: string;
}

export interface ChainVerification {
  ok: boolean;
  length: number;
  /** Hash of the last entry (genesis hash for an empty log). */
  headHash: string;
  /** First entry whose hash does not match, when `ok` is false. */
  brokenAt?: number;
  /**
   * Set when the signed head does not extend the last head this officer accepted (truncation, rollback, rewrite) or
   * cannot be checked: a plain-English explanation. The log is then shown as untrusted even if it verifies from genesis.
   */
  anchorProblem?: string;
  /**
   * The enclave audit key that signed this head, set only once its signature is verified for the attested
   * measurement and the head extends the last one this officer accepted.
   */
  headSigner?: string;
}

export interface SealedIdentityView {
  seq: number;
  ts: string;
  sourceDesk: DeskId;
  label: string;
  /** Short fingerprint of the identity sealed to the compliance key (opaque to everyone else). */
  sealed: string;
  /** Once a reveal notice is logged. `employee` is known only to the bridge that decrypted it. */
  revealed?: { employee?: EmployeeId; revealedAt: string };
}

/** A rule reason as logged in a `rule.warn` / `rule.block` entry (stable code, human-readable message). */
export interface RuleAlertReason {
  code: string;
  message?: string;
}

/**
 * One request's rule alerts against one owner. The log holds one `rule.*` entry per evaluated excerpt (and keeps
 * them all); the compliance view groups them so one attack reads as one alert.
 */
export interface RuleAlertView {
  /** Seq of the group's latest entry: unique, so a stable list key. */
  seq: number;
  /** Time of the group's latest entry. */
  ts: string;
  /** The most severe level among the grouped entries. */
  level: Exclude<RuleOutcome, "ok">;
  /** The task the flagged excerpts were requested for, when the log names it. */
  taskId: string | null;
  /** Whose agent made the request, when the log tells (directly or through `task.created`). */
  requester: EmployeeId | null;
  owner: EmployeeId | null;
  /** Number of `rule.*` entries grouped (one per flagged excerpt). */
  excerpts: number;
  /** Union of the entries' reasons, de-duplicated by code and message, in first-seen order. */
  reasons: RuleAlertReason[];
}

export interface AuditView {
  entries: AuditEntryView[];
  chain: ChainVerification;
  alerts: RuleAlertView[];
  sealed: SealedIdentityView[];
}

export interface DeskRequestsView {
  /** Requests addressed to the viewer as a member of the source desk (to approve anonymously). */
  incoming: DeskConsentView[];
  /** Requests the viewer's desk made, with anonymous deliveries. */
  outgoing: DeskRequestView[];
}

/**
 * The enclave API as used by the web app. `live.ts` implements it on @badge/client (the real enclave); the mock
 * implements it in memory for UI development only.
 */
/** What a revocation targets: one grant or standing agreement, or everything granted to one colleague. */
export type RevocationTargetView = { grantId: Hex } | { recipient: EmployeeId };

export interface EnclaveApi {
  readonly mode: EnclaveMode;
  attestation(): Promise<AttestationView>;

  enrollment(employee: EmployeeId): Promise<EnrollmentView>;
  enroll(signed: SignedMessage<"EmployeeEnroll">): Promise<EnrollmentView>;
  openSession(employee: EmployeeId, signed: SignedMessage<"AgentSession">): Promise<EnrollmentView>;

  createTask(requester: EmployeeId, input: CreateTaskInput): Promise<TaskView>;
  getTask(requester: EmployeeId, taskId: Hex): Promise<TaskView>;
  listTasks(requester: EmployeeId): Promise<TaskView[]>;

  /** Pending consent requests addressed to `owner`. */
  listConsents(owner: EmployeeId): Promise<ConsentRequestView[]>;
  /** Requests `owner` already decided, most recent first. */
  consentHistory(owner: EmployeeId): Promise<ConsentHistoryView[]>;
  approveConsent(owner: EmployeeId, consentId: string, signature: Hex): Promise<void>;
  rejectConsent(owner: EmployeeId, consentId: string): Promise<void>;

  listGrants(owner: EmployeeId): Promise<GrantView[]>;
  /**
   * The ContextRevoke the owner signs, prepared by the enclave with the canonical label of the real scope (the only
   * one `revoke` accepts): one grant or policy by id, or everything granted to one colleague.
   */
  prepareRevocation(owner: EmployeeId, target: RevocationTargetView): Promise<ContextRevoke>;
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
  registerComplianceKey(viewer: EmployeeId, input: ComplianceKeyInput): Promise<EnrollmentView>;
  /** Compliance role only. */
  audit(viewer: EmployeeId): Promise<AuditView>;
  /** Compliance role only: logs a de-anonymisation the officer's bridge already did with her Ledger-derived key. */
  revealNotice(viewer: EmployeeId, input: RevealNoticeInput): Promise<SealedIdentityView>;
}
