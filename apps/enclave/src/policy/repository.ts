/**
 * Typed repositories of the consent state: enrollments, agent sessions, consent requests, grants, standing
 * policies and revocations. Thin SQL wrappers; every decision lives in the policy engine.
 */
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { isUniqueViolation, parseRow, parseRows, type Database } from "../db";
import { EnclaveError } from "../errors";
import type { Caller } from "../security/types";

const hex = z.custom<Hex>((value) => typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value));
const address = z.string().transform((value) => getAddress(value));

export class EnrollmentRepository {
  constructor(private readonly db: Database) {}

  /** Records (or refreshes, after a re-enrollment) the binding between an employee and their Ledger address. */
  upsert(employeeId: string, ledger: Address, nowMs: number): void {
    this.db
      .prepare(
        "INSERT INTO enrollments (employee_id, address, enrolled_ms) VALUES (?, ?, ?) ON CONFLICT (employee_id) DO UPDATE SET address = excluded.address, enrolled_ms = excluded.enrolled_ms",
      )
      .run(employeeId, ledger.toLowerCase(), nowMs);
  }

  isEnrolled(employeeId: string): boolean {
    return (
      this.db.prepare("SELECT 1 AS one FROM enrollments WHERE employee_id = ?").get(employeeId) !== undefined
    );
  }
}

const SessionRowSchema = z.object({
  session_key: address,
  employee_id: z.string(),
  agent_name: z.string(),
  access: z.string(),
  expires_ms: z.number().int(),
  revoked_ms: z.number().int().nullable(),
});

const EmployeeAddressSchema = z.object({ address });

export class SessionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registers a session key. The same employee may re-delegate a key whose session has ended (an agent keeps its
   * key across days); a key that is still active, or that belonged to someone else, is refused.
   * @throws {EnclaveError} ALREADY_EXISTS
   */
  insert(session: {
    sessionKey: Address;
    employeeId: string;
    agentName: string;
    access: string;
    expiresMs: number;
    nowMs: number;
  }): void {
    const key = session.sessionKey.toLowerCase();
    const previous = this.db.prepare("SELECT * FROM sessions WHERE session_key = ?").get(key);
    if (previous) {
      const row = parseRow(SessionRowSchema, previous);
      const ended = row.revoked_ms !== null || row.expires_ms <= session.nowMs;
      if (!ended || row.employee_id !== session.employeeId) {
        throw new EnclaveError("ALREADY_EXISTS", `session key ${session.sessionKey} is already registered`);
      }
      this.db.prepare("DELETE FROM sessions WHERE session_key = ?").run(key);
    }
    try {
      this.db
        .prepare(
          "INSERT INTO sessions (session_key, employee_id, agent_name, access, expires_ms, created_ms) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          session.sessionKey.toLowerCase(),
          session.employeeId,
          session.agentName,
          session.access,
          session.expiresMs,
          session.nowMs,
        );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EnclaveError("ALREADY_EXISTS", `session key ${session.sessionKey} is already registered`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * The caller behind an unexpired, unrevoked session key of an enrolled employee, or undefined. This is the lookup
   * the authentication middleware uses after checking the request signature.
   */
  findActiveCaller(sessionKey: Address, nowMs: number): Caller | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE session_key = ? AND revoked_ms IS NULL AND expires_ms > ?")
      .get(sessionKey.toLowerCase(), nowMs);
    if (!row) return undefined;
    const session = parseRow(SessionRowSchema, row);
    const enrollment = this.db
      .prepare("SELECT address FROM enrollments WHERE employee_id = ?")
      .get(session.employee_id);
    if (!enrollment) return undefined;
    return {
      employeeId: session.employee_id,
      address: parseRow(EmployeeAddressSchema, enrollment).address,
      sessionKey: session.session_key,
    };
  }
}

export type ConsentStatus = "pending" | "approved" | "rejected" | "expired";

const ConsentRowSchema = z.object({
  id: hex,
  task_excerpt_id: z.number().int(),
  task_id: hex,
  owner_id: z.string(),
  recipient_id: z.string(),
  message: z.string(),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  created_ms: z.number().int(),
  decided_ms: z.number().int().nullable(),
  grant_id: hex.nullable(),
});
export type ConsentRow = z.infer<typeof ConsentRowSchema>;

export class ConsentRequestRepository {
  constructor(private readonly db: Database) {}

  insert(row: Omit<ConsentRow, "status" | "decided_ms" | "grant_id">): void {
    this.db
      .prepare(
        "INSERT INTO consent_requests (id, task_excerpt_id, task_id, owner_id, recipient_id, message, status, created_ms) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(
        row.id,
        row.task_excerpt_id,
        row.task_id,
        row.owner_id,
        row.recipient_id,
        row.message,
        row.created_ms,
      );
  }

  get(id: Hex): ConsentRow | undefined {
    const row = this.db.prepare("SELECT * FROM consent_requests WHERE id = ?").get(id.toLowerCase());
    return row ? parseRow(ConsentRowSchema, row) : undefined;
  }

  byTaskExcerpt(taskExcerptId: number): ConsentRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM consent_requests WHERE task_excerpt_id = ?")
      .get(taskExcerptId);
    return row ? parseRow(ConsentRowSchema, row) : undefined;
  }

  pendingForOwner(ownerId: string): ConsentRow[] {
    return parseRows(
      ConsentRowSchema,
      this.db
        .prepare(
          "SELECT * FROM consent_requests WHERE owner_id = ? AND status = 'pending' ORDER BY created_ms",
        )
        .all(ownerId),
    );
  }

  /** Moves a pending request to `status`; returns false when it was no longer pending (lost a race). */
  decide(
    id: Hex,
    status: Exclude<ConsentStatus, "pending">,
    nowMs: number,
    grantId: Hex | null = null,
  ): boolean {
    const result = this.db
      .prepare(
        "UPDATE consent_requests SET status = ?, decided_ms = ?, grant_id = ? WHERE id = ? AND status = 'pending'",
      )
      .run(status, nowMs, grantId, id.toLowerCase());
    return result.changes === 1;
  }
}

const GrantRowSchema = z.object({
  id: hex,
  owner_id: z.string(),
  recipient_id: z.string(),
  excerpt_hash: hex,
  expires_ms: z.number().int(),
  message: z.string(),
  consent_request_id: hex,
  created_ms: z.number().int(),
  revoked_ms: z.number().int().nullable(),
});
export type GrantRow = z.infer<typeof GrantRowSchema>;

export class GrantRepository {
  constructor(private readonly db: Database) {}

  /** @throws {EnclaveError} ALREADY_EXISTS when the same signed share was already turned into a grant. */
  insert(row: Omit<GrantRow, "revoked_ms"> & { signature: Hex }): void {
    try {
      this.db
        .prepare(
          "INSERT INTO grants (id, owner_id, recipient_id, excerpt_hash, expires_ms, message, signature, consent_request_id, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.id,
          row.owner_id,
          row.recipient_id,
          row.excerpt_hash.toLowerCase(),
          row.expires_ms,
          row.message,
          row.signature,
          row.consent_request_id,
          row.created_ms,
        );
    } catch (error) {
      if (isUniqueViolation(error))
        throw new EnclaveError("ALREADY_EXISTS", `grant ${row.id} exists`, { cause: error });
      throw error;
    }
  }

  get(id: Hex): GrantRow | undefined {
    const row = this.db.prepare("SELECT * FROM grants WHERE id = ?").get(id.toLowerCase());
    return row ? parseRow(GrantRowSchema, row) : undefined;
  }

  /** An unrevoked, unexpired grant of this exact excerpt from `ownerId` to `recipientId`. */
  findActive(ownerId: string, recipientId: string, excerptHash: Hex, nowMs: number): GrantRow | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM grants WHERE owner_id = ? AND recipient_id = ? AND excerpt_hash = ? AND revoked_ms IS NULL AND expires_ms > ? ORDER BY created_ms DESC LIMIT 1",
      )
      .get(ownerId, recipientId, excerptHash.toLowerCase(), nowMs);
    return row ? parseRow(GrantRowSchema, row) : undefined;
  }

  isActive(id: Hex, nowMs: number): boolean {
    const grant = this.get(id);
    return grant !== undefined && grant.revoked_ms === null && grant.expires_ms > nowMs;
  }

  activeByOwner(ownerId: string, nowMs: number): GrantRow[] {
    return parseRows(
      GrantRowSchema,
      this.db
        .prepare(
          "SELECT * FROM grants WHERE owner_id = ? AND revoked_ms IS NULL AND expires_ms > ? ORDER BY created_ms",
        )
        .all(ownerId, nowMs),
    );
  }

  revoke(id: Hex, nowMs: number): number {
    return Number(
      this.db
        .prepare("UPDATE grants SET revoked_ms = ? WHERE id = ? AND revoked_ms IS NULL")
        .run(nowMs, id.toLowerCase()).changes,
    );
  }

  revokeAllTo(ownerId: string, recipientId: string, nowMs: number): number {
    return Number(
      this.db
        .prepare(
          "UPDATE grants SET revoked_ms = ? WHERE owner_id = ? AND recipient_id = ? AND revoked_ms IS NULL",
        )
        .run(nowMs, ownerId, recipientId).changes,
    );
  }
}

const PolicyRowSchema = z.object({
  id: hex,
  owner_id: z.string(),
  grantee_team: z.string(),
  context_tag: z.string(),
  purpose: z.string(),
  max_excerpt_length: z.number().int(),
  expires_ms: z.number().int(),
  created_ms: z.number().int(),
  revoked_ms: z.number().int().nullable(),
});
export type PolicyRow = z.infer<typeof PolicyRowSchema>;

export class PolicyRepository {
  constructor(private readonly db: Database) {}

  /** @throws {EnclaveError} ALREADY_EXISTS when this exact signed policy was already registered. */
  insert(row: Omit<PolicyRow, "revoked_ms"> & { message: string; signature: Hex }): void {
    try {
      this.db
        .prepare(
          "INSERT INTO policies (id, owner_id, grantee_team, context_tag, purpose, max_excerpt_length, expires_ms, message, signature, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.id,
          row.owner_id,
          row.grantee_team,
          row.context_tag,
          row.purpose,
          row.max_excerpt_length,
          row.expires_ms,
          row.message,
          row.signature,
          row.created_ms,
        );
    } catch (error) {
      if (isUniqueViolation(error))
        throw new EnclaveError("ALREADY_EXISTS", `policy ${row.id} exists`, { cause: error });
      throw error;
    }
  }

  get(id: Hex): PolicyRow | undefined {
    const row = this.db.prepare("SELECT * FROM policies WHERE id = ?").get(id.toLowerCase());
    return row ? parseRow(PolicyRowSchema, row) : undefined;
  }

  isActive(id: Hex, nowMs: number): boolean {
    const policy = this.get(id);
    return policy !== undefined && policy.revoked_ms === null && policy.expires_ms > nowMs;
  }

  /** Every policy of the owner (active or not), with how many times each was used. */
  byOwnerWithUsage(ownerId: string): Array<PolicyRow & { uses: number }> {
    const rows = this.db
      .prepare(
        "SELECT p.*, (SELECT COUNT(*) FROM policy_uses u WHERE u.policy_id = p.id) AS uses FROM policies p WHERE p.owner_id = ? ORDER BY p.created_ms",
      )
      .all(ownerId);
    return parseRows(PolicyRowSchema.extend({ uses: z.number().int() }), rows);
  }

  /** Active policies of the owner granted to `team` for `tag`, oldest first. */
  activeFor(ownerId: string, team: string, tag: string, nowMs: number): PolicyRow[] {
    return parseRows(
      PolicyRowSchema,
      this.db
        .prepare(
          "SELECT * FROM policies WHERE owner_id = ? AND grantee_team = ? AND context_tag = ? AND revoked_ms IS NULL AND expires_ms > ? ORDER BY created_ms",
        )
        .all(ownerId, team, tag, nowMs),
    );
  }

  recordUse(use: { policyId: Hex; taskId: Hex; recipientId: string; excerptHash: Hex; nowMs: number }): void {
    this.db
      .prepare(
        "INSERT INTO policy_uses (policy_id, task_id, recipient_id, excerpt_hash, used_ms) VALUES (?, ?, ?, ?, ?)",
      )
      .run(use.policyId, use.taskId, use.recipientId, use.excerptHash.toLowerCase(), use.nowMs);
  }

  revoke(id: Hex, nowMs: number): number {
    return Number(
      this.db
        .prepare("UPDATE policies SET revoked_ms = ? WHERE id = ? AND revoked_ms IS NULL")
        .run(nowMs, id.toLowerCase()).changes,
    );
  }

  revokeForTeam(ownerId: string, team: string, nowMs: number): number {
    return Number(
      this.db
        .prepare(
          "UPDATE policies SET revoked_ms = ? WHERE owner_id = ? AND grantee_team = ? AND revoked_ms IS NULL",
        )
        .run(nowMs, ownerId, team).changes,
    );
  }
}

export class RevocationRepository {
  constructor(private readonly db: Database) {}

  insert(row: {
    id: Hex;
    ownerId: string;
    grantId: Hex;
    recipient: Address;
    targetLabel: string;
    message: string;
    signature: Hex;
    grantsRevoked: number;
    policiesRevoked: number;
    nowMs: number;
  }): void {
    this.db
      .prepare(
        "INSERT INTO revocations (id, owner_id, grant_id, recipient, target_label, message, signature, grants_revoked, policies_revoked, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.ownerId,
        row.grantId,
        row.recipient.toLowerCase(),
        row.targetLabel,
        row.message,
        row.signature,
        row.grantsRevoked,
        row.policiesRevoked,
        row.nowMs,
      );
  }
}
