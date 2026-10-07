/**
 * Compliance officer features: registering the X25519 key that anonymous desk-share signers are sealed to, reading
 * the audit log with its chain verification, and logging a de-anonymisation. Opening a sealed identity happens in
 * the officer's browser, never in the enclave: the enclave cannot read what it sealed.
 */
import { complianceKeyMessage, ConsentError, MAX_CLOCK_SKEW_SECONDS } from "@badge/consent";
import { verifyMessage, type Hex } from "viem";
import { z } from "zod";
import type { AuditEntry, ChainVerification } from "../audit";
import { nowSeconds } from "../clock";
import { transaction } from "../db";
import type { Employee } from "../directory";
import { EnclaveError } from "../errors";
import type { DomainContext } from "../policy/engine";
import type { Caller } from "../security/types";
import { ComplianceKeyRepository } from "./repository";

/** A key registration must be submitted soon after it is signed. */
export const COMPLIANCE_KEY_MAX_AGE_SECONDS = 10n * 60n;
const X25519_PUBLIC_KEY_HEX = /^0x[0-9a-fA-F]{64}$/;
const MAX_REVEAL_REASON_CHARS = 500;

/** Body of POST /v1/compliance/key. */
export const RegisterComplianceKeySchema = z.strictObject({
  publicKey: z.string().regex(X25519_PUBLIC_KEY_HEX, "must be a 32-byte 0x-prefixed hex X25519 key"),
  issuedAt: z.string().regex(/^[0-9]{1,12}$/, "unix seconds as a decimal string"),
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

  /**
   * POST /v1/compliance/key: the officer's Ledger signs (EIP-191) the key and its issue date. A registration must be
   * fresh and newer than the current key, so an old signed registration cannot be replayed to restore an old key.
   */
  async registerKey(caller: Caller, input: RegisterComplianceKeyInput): Promise<{ keyId: number }> {
    const officer = this.requireOfficer(caller);
    const address = this.ctx.directory.requireAddress(officer);
    const issuedAt = BigInt(input.issuedAt);
    const now = nowSeconds(this.ctx.clock);
    if (issuedAt > now + MAX_CLOCK_SKEW_SECONDS || now - issuedAt > COMPLIANCE_KEY_MAX_AGE_SECONDS) {
      throw new EnclaveError("STALE", "the key registration is not fresh");
    }
    const current = this.keys.latest();
    if (current && BigInt(current.issued_s) >= issuedAt) {
      throw new EnclaveError("STALE", "a newer compliance key is already registered");
    }
    const publicKey = input.publicKey.toLowerCase() as Hex;
    const message = complianceKeyMessage(this.ctx.directory.company.name, publicKey, issuedAt);
    const valid = await verifyMessage({ address, message, signature: input.signature as Hex });
    if (!valid)
      throw new ConsentError(
        "SIGNATURE_MISMATCH",
        "the key registration is not signed by the officer's Ledger",
      );
    const nowMs = this.ctx.clock.now().getTime();
    return transaction(this.ctx.db, () => {
      const keyId = this.keys.insert({
        employeeId: officer.id,
        publicKey,
        issuedAt: Number(issuedAt),
        signature: input.signature as Hex,
        nowMs,
      });
      this.ctx.audit.append({
        type: "compliance.key",
        actor: officer.id,
        subject: String(keyId),
        data: { keyId, publicKey, issuedAt: issuedAt.toString() },
      });
      return { keyId };
    });
  }

  /** GET /v1/audit: a page of entries plus the verification of the whole chain. */
  readAudit(
    caller: Caller,
    query: z.infer<typeof AuditQuerySchema>,
  ): { entries: AuditEntry[]; verification: ChainVerification } {
    this.requireOfficer(caller);
    return { entries: this.ctx.audit.list(query), verification: this.ctx.audit.verify() };
  }

  /** POST /v1/audit/reveal-notice: records that the officer opened the sealed identity of a desk share. */
  revealNotice(caller: Caller, input: RevealNoticeInput): { seq: number } {
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
    return { seq: notice.seq };
  }
}
