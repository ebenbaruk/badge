/**
 * The policy engine: every signed message that changes who may see what goes through here. Stateless checks come
 * from @badge/consent (signature recovery, intrinsic checks); this engine adds the stateful ones (directory,
 * enrollment, nonce reuse, revocation) and applies the effect in one transaction with its audit entry.
 *
 * Pattern of every operation: decode -> async signature check -> sync checks -> one transaction (nonce consumed,
 * effect applied, audit appended). Any failure throws before the transaction commits: the engine fails closed.
 */
import type {
  ConsentDecision,
  ConsentListWire,
  EnrollResponse,
  Grant,
  Policy,
  RevocationResult,
  Session,
} from "@badge/client";
import {
  checkAgentSession,
  checkContextPolicy,
  checkContextRevoke,
  checkContextShare,
  checkEmployeeEnroll,
  decodeBadgeMessage,
  decodeSignedMessage,
  encodeBadgeMessage,
  hashBadgeMessage,
  toDeviceAscii,
  verifyBadgeSignature,
} from "@badge/consent";
import { getAddress, isAddressEqual, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import type { AuditLog } from "../audit";
import { msToUnixSeconds, nowSeconds, secondsToMs, type Clock } from "../clock";
import { transaction, type Database, NonceRepository } from "../db";
import type { Directory, Employee } from "../directory";
import { EnclaveError } from "../errors";
import type { Caller } from "../security/types";
import { TaskRepository, type ExcerptRow } from "../tasks/repository";
import type { EnclaveMeasurement, OwnerKeyRotator } from "./ports";
import {
  ConsentRequestRepository,
  EnrollmentRepository,
  GrantRepository,
  PolicyRepository,
  RevocationRepository,
  SessionRepository,
  type ConsentRow,
  type GrantRow,
  type PolicyRow,
} from "./repository";

/** A pending one-off share as listed by GET /v1/consents (signed message in its JSON wire form). */
export type ContextShareConsentWire = Extract<ConsentListWire["consents"][number], { kind: "ContextShare" }>;

/** The contract requires a fresh enrollment: stricter than the 1-day horizon @badge/consent allows. */
export const ENROLL_MAX_AGE_SECONDS = 10n * 60n;
/** An agent session lives at most one working day (the consent package allows up to 7 days). */
export const SESSION_MAX_TTL_SECONDS = 12n * 60n * 60n;

/** Dependencies shared by the enclave's domain services. */
export interface DomainContext {
  readonly db: Database;
  readonly directory: Directory;
  readonly audit: AuditLog;
  readonly clock: Clock;
  readonly enclave: EnclaveMeasurement;
}

export class PolicyEngine {
  readonly nonces: NonceRepository;
  readonly enrollments: EnrollmentRepository;
  readonly sessions: SessionRepository;
  readonly consents: ConsentRequestRepository;
  readonly grants: GrantRepository;
  readonly policies: PolicyRepository;
  readonly revocations: RevocationRepository;
  readonly tasks: TaskRepository;

  constructor(
    private readonly ctx: DomainContext,
    private readonly keyRotator: OwnerKeyRotator,
  ) {
    this.nonces = new NonceRepository(ctx.db);
    this.enrollments = new EnrollmentRepository(ctx.db);
    this.sessions = new SessionRepository(ctx.db);
    this.consents = new ConsentRequestRepository(ctx.db);
    this.grants = new GrantRepository(ctx.db);
    this.policies = new PolicyRepository(ctx.db);
    this.revocations = new RevocationRepository(ctx.db);
    this.tasks = new TaskRepository(ctx.db);
  }

  private nowMs(): number {
    return this.ctx.clock.now().getTime();
  }

  private checkContext() {
    return { now: nowSeconds(this.ctx.clock), enclaveMeasurement: this.ctx.enclave.measurement };
  }

  /** The directory employee holding the Ledger `address`. @throws {EnclaveError} UNKNOWN_EMPLOYEE */
  private employeeAt(address: Address): Employee & { address: Address } {
    const employee = this.ctx.directory.byAddress(address);
    if (!employee?.address)
      throw new EnclaveError("UNKNOWN_EMPLOYEE", `${address} is not a directory Ledger address`);
    return { ...employee, address: employee.address };
  }

  /** The caller must be the employee whose Ledger signed `signer`. @throws {EnclaveError} FORBIDDEN */
  private assertCallerIs(caller: Caller, employee: Employee, what: string): void {
    if (caller.employeeId !== employee.id) {
      throw new EnclaveError("FORBIDDEN", `${what} must be submitted by its signer's own agent`);
    }
  }

  /**
   * POST /v1/enroll: binds a directory employee to their Ledger. The message must repeat the directory identity
   * exactly as the device showed it, be signed by the directory address, fresh, and pinned to this enclave.
   */
  async enroll(body: unknown): Promise<EnrollResponse> {
    const { message, signature } = decodeSignedMessage(body, "EmployeeEnroll");
    const employee = this.employeeAt(message.employee);
    const { directory } = this.ctx;
    if (
      message.company !== directory.company.name ||
      message.employeeName !== toDeviceAscii(employee.name) ||
      message.team !== toDeviceAscii(employee.team)
    ) {
      throw new EnclaveError("INVALID_REQUEST", "the signed identity does not match the directory");
    }
    await verifyBadgeSignature("EmployeeEnroll", message, signature, employee.address);
    const context = this.checkContext();
    checkEmployeeEnroll(message, context);
    if (context.now - message.issuedAt > ENROLL_MAX_AGE_SECONDS) {
      throw new EnclaveError("STALE", `EmployeeEnroll must be submitted within ${ENROLL_MAX_AGE_SECONDS}s`);
    }
    const nowMs = this.nowMs();
    transaction(this.ctx.db, () => {
      this.nonces.consume(employee.address, message.nonce, "EmployeeEnroll", nowMs);
      this.enrollments.upsert(employee.id, employee.address, nowMs);
      this.ctx.audit.append({
        type: "enroll",
        actor: employee.id,
        subject: employee.id,
        data: { address: employee.address },
      });
    });
    return { employee: directory.profile(employee) };
  }

  /** POST /v1/sessions: registers an agent session key delegated by an enrolled employee's Ledger. */
  async openSession(body: unknown): Promise<Session> {
    const { message, signature } = decodeSignedMessage(body, "AgentSession");
    const employee = this.employeeAt(message.employee);
    if (!this.enrollments.isEnrolled(employee.id)) {
      throw new EnclaveError("NOT_ENROLLED", `${employee.id} must enroll before delegating to an agent`);
    }
    await verifyBadgeSignature("AgentSession", message, signature, employee.address);
    const context = this.checkContext();
    checkAgentSession(message, context);
    if (message.expiresAt - context.now > SESSION_MAX_TTL_SECONDS) {
      throw new EnclaveError(
        "SESSION_TOO_LONG",
        `an agent session lasts at most ${SESSION_MAX_TTL_SECONDS}s`,
      );
    }
    // A Ledger address can never act as a session key: requests signed by it would pass as Ledger consents.
    if (this.ctx.directory.byAddress(message.sessionKey)) {
      throw new EnclaveError("INVALID_REQUEST", "a session key cannot be an employee's Ledger address");
    }
    const nowMs = this.nowMs();
    const sessionKey = getAddress(message.sessionKey);
    transaction(this.ctx.db, () => {
      this.nonces.consume(employee.address, message.nonce, "AgentSession", nowMs);
      this.sessions.insert({
        sessionKey,
        employeeId: employee.id,
        agentName: message.agentName,
        access: message.access,
        expiresMs: secondsToMs(message.expiresAt),
        nowMs,
      });
      this.ctx.audit.append({
        type: "session.open",
        actor: employee.id,
        subject: sessionKey,
        data: { sessionKey, agentName: message.agentName, expiresAt: message.expiresAt.toString() },
      });
    });
    return {
      sessionKey,
      employeeId: employee.id,
      agentName: message.agentName,
      expiresAt: Number(message.expiresAt),
    };
  }

  /** An active one-off grant of this exact excerpt, if any (a grant is reusable until it expires or is revoked). */
  findActiveGrant(ownerId: string, recipientId: string, excerptHash: Hex): GrantRow | undefined {
    return this.grants.findActive(ownerId, recipientId, excerptHash, this.nowMs());
  }

  /**
   * The first active standing policy that covers this excerpt for the recipient: team == granteeTeam, one of the
   * excerpt's tags == contextTag, length <= maxExcerptLength, not expired or revoked.
   */
  findMatchingPolicy(
    ownerId: string,
    recipient: Employee,
    excerpt: { tags: readonly string[]; length: number },
  ): PolicyRow | undefined {
    const team = toDeviceAscii(recipient.team);
    const nowMs = this.nowMs();
    for (const tag of excerpt.tags) {
      const match = this.policies
        .activeFor(ownerId, team, toDeviceAscii(tag), nowMs)
        .find((policy) => excerpt.length <= policy.max_excerpt_length);
      if (match) return match;
    }
    return undefined;
  }

  /**
   * Pending consent requests addressed to the caller, with the exact message to sign and the risk flags. The owner
   * sees their own excerpt in full: they cannot judge a request without reading what would leave.
   */
  pendingConsents(caller: Caller): ContextShareConsentWire[] {
    this.expirePending(caller.employeeId);
    return this.consents.pendingForOwner(caller.employeeId).map((row) => {
      const excerpt = this.requireExcerpt(row.task_excerpt_id);
      const message = decodeBadgeMessage("ContextShare", JSON.parse(row.message));
      return {
        kind: "ContextShare",
        id: row.id,
        status: "pending",
        taskId: row.task_id,
        requester: this.ctx.directory.person(row.recipient_id),
        excerpt: {
          label: excerpt.label,
          length: excerpt.length,
          text: excerpt.text,
          tags: [...excerpt.tags],
        },
        message: encodeBadgeMessage("ContextShare", message),
        risk: { level: excerpt.risk, reasons: [...excerpt.risk_reasons] },
        createdAt: msToUnixSeconds(row.created_ms),
      };
    });
  }

  /** Marks the owner's pending requests whose signed message would already be expired. */
  expirePending(ownerId: string): void {
    const now = nowSeconds(this.ctx.clock);
    const nowMs = this.nowMs();
    transaction(this.ctx.db, () => {
      for (const row of this.consents.pendingForOwner(ownerId)) {
        const message = decodeBadgeMessage("ContextShare", JSON.parse(row.message));
        if (message.expiresAt > now) continue;
        if (this.consents.decide(row.id, "expired", nowMs)) {
          this.tasks.setDecision(row.task_excerpt_id, "expired", null);
        }
      }
    });
  }

  private requireExcerpt(id: number): ExcerptRow {
    const excerpt = this.tasks.excerpt(id);
    // A consent request always points at its excerpt (foreign key); a miss is a corrupted state, not a user error.
    if (!excerpt) throw new Error(`consent request references missing excerpt ${id}`);
    return excerpt;
  }

  private requirePendingConsent(caller: Caller, consentId: Hex): ConsentRow {
    const row = this.consents.get(consentId);
    // Someone else's request is reported as missing: its existence is not the caller's business.
    if (!row || row.owner_id !== caller.employeeId) {
      throw new EnclaveError("NOT_FOUND", `no consent request ${consentId} for ${caller.employeeId}`);
    }
    if (row.status !== "pending") throw new EnclaveError("NOT_PENDING", `consent request is ${row.status}`);
    return row;
  }

  /**
   * POST /v1/consents/:id/approve: the owner's Ledger signature of the prepared ContextShare turns the request into
   * a grant (id = EIP-712 digest), after checking it against the exact excerpt text stored for the task.
   */
  async approveConsent(caller: Caller, consentId: Hex, signature: Hex): Promise<ConsentDecision> {
    const row = this.requirePendingConsent(caller, consentId);
    const message = decodeBadgeMessage("ContextShare", JSON.parse(row.message));
    const owner = this.ctx.directory.requireEmployee(row.owner_id);
    const ownerAddress = this.ctx.directory.requireAddress(owner);
    await verifyBadgeSignature("ContextShare", message, signature, ownerAddress);
    const excerpt = this.requireExcerpt(row.task_excerpt_id);
    checkContextShare(message, { ...this.checkContext(), excerptText: excerpt.text });
    const grantId = hashBadgeMessage("ContextShare", message);
    const nowMs = this.nowMs();
    transaction(this.ctx.db, () => {
      // Re-checked inside the transaction: a concurrent approve or reject may have won since the first read.
      if (!this.consents.decide(row.id, "approved", nowMs, grantId)) {
        throw new EnclaveError("NOT_PENDING", "consent request was decided concurrently");
      }
      this.nonces.consume(ownerAddress, message.nonce, "ContextShare", nowMs);
      this.grants.insert({
        id: grantId,
        owner_id: owner.id,
        recipient_id: row.recipient_id,
        excerpt_hash: message.excerptHash,
        expires_ms: secondsToMs(message.expiresAt),
        message: row.message,
        signature,
        consent_request_id: row.id,
        created_ms: nowMs,
      });
      this.tasks.setDecision(row.task_excerpt_id, "allowed", "consent", grantId);
      this.ctx.audit.append({
        type: "consent.approved",
        actor: owner.id,
        subject: row.id,
        data: { consentId: row.id, grantId, excerptHash: message.excerptHash },
      });
    });
    return { consentId: row.id, status: "approved", grantId };
  }

  /** POST /v1/consents/:id/reject: no signature needed, refusing can only reduce access. */
  rejectConsent(caller: Caller, consentId: Hex): ConsentDecision {
    const row = this.requirePendingConsent(caller, consentId);
    const excerpt = this.requireExcerpt(row.task_excerpt_id);
    const nowMs = this.nowMs();
    transaction(this.ctx.db, () => {
      if (!this.consents.decide(row.id, "rejected", nowMs)) {
        throw new EnclaveError("NOT_PENDING", "consent request was decided concurrently");
      }
      this.tasks.setDecision(row.task_excerpt_id, "rejected", null);
      this.ctx.audit.append({
        type: "consent.rejected",
        actor: caller.employeeId,
        subject: row.id,
        data: { consentId: row.id, excerptHash: excerpt.excerpt_hash },
      });
    });
    return { consentId: row.id, status: "rejected", grantId: null };
  }

  /** Active one-off grants the caller gave (what they can revoke). */
  activeGrants(caller: Caller): Grant[] {
    return this.grants.activeByOwner(caller.employeeId, this.nowMs()).map((grant) => {
      const message = decodeBadgeMessage("ContextShare", JSON.parse(grant.message));
      return {
        id: grant.id,
        recipient: this.ctx.directory.person(grant.recipient_id),
        excerptLabel: message.excerptLabel,
        excerptLength: message.excerptLength,
        taskLabel: message.taskLabel,
        expiresAt: msToUnixSeconds(grant.expires_ms),
        createdAt: msToUnixSeconds(grant.created_ms),
      };
    });
  }

  /** POST /v1/policies: registers a standing agreement signed on the owner's Ledger. */
  async createPolicy(caller: Caller, body: unknown): Promise<Policy> {
    const { message, signature } = decodeSignedMessage(body, "ContextPolicy");
    const owner = this.employeeAt(message.owner);
    this.assertCallerIs(caller, owner, "a policy");
    await verifyBadgeSignature("ContextPolicy", message, signature, owner.address);
    checkContextPolicy(message, this.checkContext());
    const teams = [...this.ctx.directory.teams()].map((team) => toDeviceAscii(team));
    if (!teams.includes(message.granteeTeam)) {
      throw new EnclaveError("INVALID_REQUEST", `no team "${message.granteeTeam}" in the directory`);
    }
    const policyId = hashBadgeMessage("ContextPolicy", message);
    const nowMs = this.nowMs();
    transaction(this.ctx.db, () => {
      this.nonces.consume(owner.address, message.nonce, "ContextPolicy", nowMs);
      this.policies.insert({
        id: policyId,
        owner_id: owner.id,
        grantee_team: message.granteeTeam,
        context_tag: message.contextTag,
        purpose: message.purpose,
        max_excerpt_length: message.maxExcerptLength,
        expires_ms: secondsToMs(message.expiresAt),
        created_ms: nowMs,
        message: JSON.stringify(encodeBadgeMessage("ContextPolicy", message)),
        signature,
      });
      this.ctx.audit.append({
        type: "policy.created",
        actor: owner.id,
        subject: policyId,
        data: {
          policyId,
          granteeTeam: message.granteeTeam,
          contextTag: message.contextTag,
          maxExcerptLength: message.maxExcerptLength,
          expiresAt: message.expiresAt.toString(),
        },
      });
    });
    const created = this.listPolicies(caller).find((policy) => policy.id === policyId);
    if (!created) throw new Error(`policy ${policyId} missing right after its creation`);
    return created;
  }

  /** GET /v1/policies: the caller's standing agreements with their usage counts. */
  listPolicies(caller: Caller): Policy[] {
    const nowMs = this.nowMs();
    return this.policies.byOwnerWithUsage(caller.employeeId).map((policy) => ({
      id: policy.id,
      granteeTeam: policy.grantee_team,
      contextTag: policy.context_tag,
      purpose: policy.purpose,
      maxExcerptLength: policy.max_excerpt_length,
      expiresAt: msToUnixSeconds(policy.expires_ms),
      createdAt: msToUnixSeconds(policy.created_ms),
      status: policy.revoked_ms !== null ? "revoked" : policy.expires_ms <= nowMs ? "expired" : "active",
      uses: policy.uses,
    }));
  }

  /**
   * POST /v1/revocations: revokes one grant or policy (grantId), or everything granted to `recipient`
   * (grantId = 0x0: their one-off grants and the policies granted to their team). The owner's data key is
   * rotated before the revocation is recorded, so a recorded revocation always comes with a rotated key.
   */
  async revoke(caller: Caller, body: unknown): Promise<RevocationResult> {
    const { message, signature } = decodeSignedMessage(body, "ContextRevoke");
    const owner = this.employeeAt(message.owner);
    this.assertCallerIs(caller, owner, "a revocation");
    await verifyBadgeSignature("ContextRevoke", message, signature, owner.address);
    checkContextRevoke(message, this.checkContext());
    const revokeAll = message.grantId === zeroHash;
    const recipient = revokeAll ? this.ctx.directory.byAddress(message.recipient) : undefined;
    if (revokeAll && (!recipient || isAddressEqual(message.recipient, zeroAddress))) {
      throw new EnclaveError("INVALID_REQUEST", "revoking everything needs a directory recipient");
    }
    if (this.nonces.isUsed(owner.address, message.nonce)) {
      throw new EnclaveError("NONCE_REUSED", `nonce ${message.nonce} of ${owner.address} was already used`);
    }
    await this.keyRotator.rotate(owner.id);
    const revocationId = hashBadgeMessage("ContextRevoke", message);
    const nowMs = this.nowMs();
    return transaction(this.ctx.db, () => {
      this.nonces.consume(owner.address, message.nonce, "ContextRevoke", nowMs);
      let grantsRevoked = 0;
      let policiesRevoked = 0;
      if (recipient) {
        grantsRevoked = this.grants.revokeAllTo(owner.id, recipient.id, nowMs);
        policiesRevoked = this.policies.revokeForTeam(owner.id, toDeviceAscii(recipient.team), nowMs);
      } else {
        const grant = this.grants.get(message.grantId);
        const policy = this.policies.get(message.grantId);
        if (grant?.owner_id === owner.id) grantsRevoked = this.grants.revoke(message.grantId, nowMs);
        else if (policy?.owner_id === owner.id)
          policiesRevoked = this.policies.revoke(message.grantId, nowMs);
        else throw new EnclaveError("NOT_FOUND", `no grant or policy ${message.grantId} of ${owner.id}`);
      }
      this.revocations.insert({
        id: revocationId,
        ownerId: owner.id,
        grantId: message.grantId,
        recipient: message.recipient,
        targetLabel: message.targetLabel,
        message: JSON.stringify(encodeBadgeMessage("ContextRevoke", message)),
        signature,
        grantsRevoked,
        policiesRevoked,
        nowMs,
      });
      this.ctx.audit.append({
        type: "revoke",
        actor: owner.id,
        subject: message.grantId,
        data: {
          revocationId,
          grantId: message.grantId,
          recipient: message.recipient,
          grantsRevoked,
          policiesRevoked,
          keyRotated: true,
        },
      });
      return { revocationId, revokedGrants: grantsRevoked, revokedPolicies: policiesRevoked };
    });
  }
}
