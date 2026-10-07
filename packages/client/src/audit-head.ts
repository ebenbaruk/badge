/**
 * Anchoring of the compliance log. The enclave verifies its own hash chain, but a chain that was truncated, or a
 * whole disk rolled back to an earlier snapshot, still verifies from genesis. So every audit read carries the head
 * (length, hash of the last entry) signed by an enclave key derived from the dstack KMS (only this deployment can
 * derive it), and the officer's client remembers the last head it saw: a later read must extend it.
 */
import { isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import type { AuditEntry, AuditLog } from "./api-schemas";

/** Version tag of the signed head, like the request signature's. */
export const AUDIT_HEAD_PREFIX = "BADGE-AUDIT-HEAD-V1";

/** What the enclave signs (EIP-191) for a verified chain of `length` entries ending with `head`. */
export function auditHeadMessage(input: { measurement: Hex; length: number; head: string }): string {
  return [AUDIT_HEAD_PREFIX, input.measurement.toLowerCase(), String(input.length), input.head].join("\n");
}

/** The last head an officer's client accepted (persist it: it is what detects a rollback). */
export interface AuditHeadRecord {
  length: number;
  head: string;
  /** The enclave's audit signing address, pinned on first sight. */
  signer: Address;
}

export type AuditHeadProblem =
  "broken" | "unsigned" | "bad_signature" | "signer_changed" | "shorter" | "diverged";

export type AuditHeadCheck = { ok: true; record: AuditHeadRecord } | { ok: false; problem: AuditHeadProblem };

/**
 * Checks a full audit read against the head the officer saw last.
 * @param log the first page's `chain` (signed head) and ALL entries read since (paging may add newer ones).
 * @param measurement the attested enclave measurement the head must be signed for.
 * @param previous the last accepted head, if any.
 */
export async function checkAuditHead(
  log: { chain: AuditLog["chain"]; entries: readonly AuditEntry[] },
  measurement: Hex,
  previous: AuditHeadRecord | undefined,
): Promise<AuditHeadCheck> {
  const { chain, entries } = log;
  if (!chain.valid || chain.head === null) return { ok: false, problem: "broken" };
  if (chain.signedHead === null || !isAddress(chain.signedHead.signer))
    return { ok: false, problem: "unsigned" };
  const { signer, signature } = chain.signedHead;
  let recovered: Address;
  try {
    recovered = await recoverMessageAddress({
      message: auditHeadMessage({ measurement, length: chain.length, head: chain.head }),
      signature,
    });
  } catch {
    return { ok: false, problem: "bad_signature" };
  }
  if (recovered.toLowerCase() !== signer.toLowerCase()) return { ok: false, problem: "bad_signature" };
  // The signed head must be the one of the entries actually returned.
  const headEntry = chain.length === 0 ? undefined : entries[chain.length - 1];
  if (chain.length > 0 && headEntry?.hash !== chain.head) return { ok: false, problem: "diverged" };
  if (previous !== undefined) {
    if (previous.signer.toLowerCase() !== signer.toLowerCase())
      return { ok: false, problem: "signer_changed" };
    if (chain.length < previous.length) return { ok: false, problem: "shorter" };
    const seen = previous.length === 0 ? undefined : entries[previous.length - 1];
    if (previous.length > 0 && seen?.hash !== previous.head) return { ok: false, problem: "diverged" };
  }
  return { ok: true, record: { length: chain.length, head: chain.head, signer } };
}
