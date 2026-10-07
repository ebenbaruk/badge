/**
 * Every event of the compliance log, with the exact shape of its data. The shapes are closed on purpose: there is
 * no field where excerpt text could be written, only hashes, lengths, ids and our own reason codes.
 */
import type { RiskReason } from "../policy/rules";
import type { SealedBox } from "@badge/attest";

type Hex = `0x${string}`;

export interface AuditEventData {
  enroll: { address: string };
  "session.open": { sessionKey: string; agentName: string; expiresAt: string };
  "task.created": {
    taskId: Hex;
    taskLabel: string;
    fullContextOf: string | null;
    allowed: number;
    pending: number;
    blocked: number;
  };
  "consent.requested": {
    consentId: Hex;
    taskId: Hex;
    owner: string;
    recipient: string;
    excerptHash: Hex;
    excerptLength: number;
    risk: "ok" | "warn";
  };
  "consent.approved": { consentId: Hex; grantId: Hex; excerptHash: Hex };
  "consent.rejected": { consentId: Hex; excerptHash: Hex };
  "grant.reused": { grantId: Hex; taskId: Hex; excerptHash: Hex };
  "policy.created": {
    policyId: Hex;
    granteeTeam: string;
    contextTag: string;
    maxExcerptLength: number;
    expiresAt: string;
  };
  "policy.used": { policyId: Hex; taskId: Hex; recipient: string; excerptHash: Hex };
  revoke: {
    revocationId: Hex;
    grantId: Hex;
    recipient: string;
    grantsRevoked: number;
    policiesRevoked: number;
    keyRotated: boolean;
  };
  "rule.warn": { taskId: Hex; owner: string; excerptHash: Hex; excerptLength: number; reasons: RiskReason[] };
  "rule.block": {
    taskId: Hex;
    owner: string;
    excerptHash: Hex;
    excerptLength: number;
    reasons: RiskReason[];
  };
  "desk.join": { desk: string; commitment: string; root: string; members: number };
  "desk.request": { requestId: Hex; ruleId: string; fromDesk: string; sourceDesk: string; offers: number };
  "desk.share": {
    requestId: Hex;
    ruleId: string;
    sourceDesk: string;
    recipientDesk: string;
    excerptHash: Hex;
    nullifier: string;
    complianceKeyId: number;
    /** Who signed, sealed to the compliance officer's key: unreadable by the enclave operator or the requester. */
    sealedSigner: SealedBox;
  };
  "compliance.key": { keyId: number; publicKey: string };
  "compliance.reveal": { auditSeq: number; reason: string };
}

export type AuditEventType = keyof AuditEventData;

export const AUDIT_EVENT_TYPES = [
  "enroll",
  "session.open",
  "task.created",
  "consent.requested",
  "consent.approved",
  "consent.rejected",
  "grant.reused",
  "policy.created",
  "policy.used",
  "revoke",
  "rule.warn",
  "rule.block",
  "desk.join",
  "desk.request",
  "desk.share",
  "compliance.key",
  "compliance.reveal",
] as const satisfies readonly AuditEventType[];

/** An event to append: `actor` is who acted (employee id or "enclave"), `subject` what it is about. */
export type AuditEvent = {
  [T in AuditEventType]: { type: T; actor: string; subject: string; data: AuditEventData[T] };
}[AuditEventType];
