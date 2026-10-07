/**
 * Compliance officer features: registering the X25519 key that anonymous desk-share signers are sealed to, reading
 * the audit log with its chain verification, and logging a de-anonymisation. Opening a sealed identity happens on
 * the officer's side, never in the enclave: the enclave cannot read what it sealed.
 */
import { complianceKeyRegistrationMessage } from "@badge/attest";
import type {
  AuditEntry as AuditEntryWire,
  AuditLog as AuditLogWire,
  ComplianceKey,
  CurrentComplianceKey,
} from "@badge/client";
import { ConsentError } from "@badge/consent";
import { verifyMessage, type Hex } from "viem";
import { z } from "zod";
import type { AuditEntry } from "../audit";
import { msToUnixSeconds } from "../clock";
import { transaction } from "../db";
import type { Employee } from "../directory";
import { EnclaveError } from "../errors";
import type { DomainContext } from "../policy/engine";
import type { Caller } from "../security/types";
import { ComplianceKeyRepository, type ComplianceKeyRow } from "./repository";

const X25519_PUBLIC_KEY_HEX = /^(0x)?[0-9a-fA-F]{64}$/;
const MAX_REVEAL_REASON_CHARS = 500;

/** Body of POST /v1/compliance/key. */
export const RegisterComplianceKeySchema = z.strictObject({
  publicKey: z
    .string()
    .regex(X25519_PUBLIC_KEY_HEX, "must be a 32-byte hex X25519 key")
    .transform((key) => key.replace(/^0x/, "").toLowerCase()),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65-byte hex signature"),
});
export type RegisterComplianceKeyInput = z.infer<typeof RegisterComplianceKeySchema>;

/** Body of POST /v1/audit/reveal-notice. */
export const RevealNoticeSchema = z.strictObject({
  seq: z.number().int().positive(),
  reason: z.string().trim().min(1).max(MAX_REVEAL_REASON_CHARS),
});
export type RevealNoticeInput = z.infer<typeof RevealNoticeSchema>;

/** Query of GET /v1/audit. */
export const AuditQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

/** An audit entry as the API returns it (unix seconds). */
export function toAuditEntryWire(entry: AuditEntry): AuditEntryWire {
  return { ...entry, ts: msToUnixSeconds(entry.ts), data: { ...entry.data } };
}

function toComplianceKeyWire(row: ComplianceKeyRow): ComplianceKey {
  return {
    keyId: row.id,
    employeeId: row.employee_id,
    publicKey: row.public_key,
    registeredAt: msToUnixSeconds(row.registered_ms),
  };
}

export class ComplianceService {
  private readonly keys: ComplianceKeyRepository;

  constructor(private readonly ctx: DomainContext) {
    this.keys = new ComplianceKeyRepository(ctx.db);
  }

  /** @throws {EnclaveError} FORBIDDEN unless the caller has the compliance role. */
  private requireOfficer(caller: Caller): Employee {
    const employee = this.ctx.directory.requireEmployee(caller.employeeId);
    if (employee.role !== "compliance") throw new EnclaveError("FORBIDDEN", "compliance role required");
    return employee;
  }

  /** GET /v1/compliance/key: the current sealing key (null before the first registration), officer only. */
  currentKey(caller: Caller): CurrentComplianceKey {
    this.requireOfficer(caller);
    const current = this.keys.latest();
    return { key: current === undefined ? null : toComplianceKeyWire(current) };
  }

  /**
   * POST /v1/compliance/key: the officer's Ledger signs (EIP-191) `complianceKeyRegistrationMessage`. The key is
   * derived deterministically from her Ledger, so registering the current key again is a no-op; a key that was
   * replaced can never become current again (an old signed registration replayed would otherwise restore it).
   */
  async registerKey(caller: Caller, input: RegisterComplianceKeyInput): Promise<ComplianceKey> {
    const officer = this.requireOfficer(caller);
    const address = this.ctx.directory.requireAddress(officer);
    const message = complianceKeyRegistrationMessage(this.ctx.directory.company.name, input.publicKey);
    const valid = await verifyMessage({ address, message, signature: input.signature as Hex });
    if (!valid) {
      throw new ConsentError(
        "SIGNATURE_MISMATCH",
        "the key registration is not signed by the officer's Ledger",
      );
    }
    const nowMs = this.ctx.clock.now().getTime();
    return transaction(this.ctx.db, () => {
      const current = this.keys.latest();
      if (current?.public_key === input.publicKey) return toComplianceKeyWire(current);
      if (this.keys.wasRegistered(input.publicKey)) {
        throw new EnclaveError("STALE", "this compliance key was replaced and cannot be restored");
      }
      const row = this.keys.insert({
        employeeId: officer.id,
        publicKey: input.publicKey,
        signature: input.signature as Hex,
        nowMs,
      });
      this.ctx.audit.append({
        type: "compliance.key",
        actor: officer.id,
        subject: String(row.id),
        data: { keyId: row.id, publicKey: row.public_key },
      });
      return toComplianceKeyWire(row);
    });
  }

  /** GET /v1/audit: a page of entries plus the verification of the whole chain. */
  readAudit(caller: Caller, query: z.infer<typeof AuditQuerySchema>): AuditLogWire {
    this.requireOfficer(caller);
    const verification = this.ctx.audit.verify();
    return {
      entries: this.ctx.audit.list(query).map(toAuditEntryWire),
      chain: verification.valid
        ? { valid: true, length: verification.length, brokenAt: null }
        : // On a break, `length` is the verified prefix: entries before the first broken one.
          { valid: false, length: verification.brokenAt - 1, brokenAt: verification.brokenAt },
    };
  }

  /** POST /v1/audit/reveal-notice: records that the officer opened the sealed identity of a desk share. */
  revealNotice(caller: Caller, input: RevealNoticeInput): AuditEntryWire {
    const officer = this.requireOfficer(caller);
    const entry = this.ctx.audit.get(input.seq);
    if (!entry || entry.type !== "desk.share") {
      throw new EnclaveError("NOT_FOUND", `audit entry ${input.seq} is not an anonymous desk share`);
    }
    const notice = this.ctx.audit.append({
      type: "compliance.reveal",
      actor: officer.id,
      subject: String(input.seq),
      data: { auditSeq: input.seq, reason: input.reason },
    });
    return toAuditEntryWire(notice);
  }
}
