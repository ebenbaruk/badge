/**
 * Append-only, hash-chained compliance log (same shape as the enclave's: hash = sha256(prevHash | canonical entry)).
 * Entries carry hashes and labels only, never excerpt text.
 */
import { createHash } from "node:crypto";
import type { Hex } from "viem";
import type { AuditEntryView, ChainVerification } from "../enclave/types";

export const GENESIS_HASH: Hex = `0x${"0".repeat(64)}`;

export type AuditType =
  | "enroll"
  | "session.open"
  | "task.created"
  | "consent.requested"
  | "consent.approved"
  | "consent.rejected"
  | "grant.reused"
  | "policy.created"
  | "policy.used"
  | "revoke"
  | "rule.warn"
  | "rule.block"
  | "desk.join"
  | "desk.share"
  | "compliance.reveal";

type AuditInput = Pick<AuditEntryView, "type" | "actor" | "subject" | "data"> & { type: AuditType };

/** JSON with object keys sorted recursively: the same entry always hashes to the same value. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function entryHash(prevHash: Hex, entry: Omit<AuditEntryView, "prevHash" | "hash">): Hex {
  const body = canonicalJson({
    seq: entry.seq,
    ts: entry.ts,
    type: entry.type,
    actor: entry.actor,
    subject: entry.subject,
    data: entry.data,
  });
  return `0x${createHash("sha256").update(`${prevHash}|${body}`).digest("hex")}`;
}

/** Recomputes the whole chain; reports the first entry that does not link or hash correctly. */
export function verifyChain(entries: readonly AuditEntryView[]): ChainVerification {
  let prevHash = GENESIS_HASH;
  for (const [index, entry] of entries.entries()) {
    if (entry.seq !== index + 1 || entry.prevHash !== prevHash || entryHash(prevHash, entry) !== entry.hash) {
      return { ok: false, length: entries.length, headHash: prevHash, brokenAt: entry.seq };
    }
    prevHash = entry.hash;
  }
  return { ok: true, length: entries.length, headHash: prevHash };
}

export class AuditLog {
  readonly #entries: AuditEntryView[] = [];

  append(input: AuditInput, now: Date = new Date()): AuditEntryView {
    const prevHash = this.#entries.at(-1)?.hash ?? GENESIS_HASH;
    const base = { seq: this.#entries.length + 1, ts: now.toISOString(), ...input };
    const entry: AuditEntryView = { ...base, prevHash, hash: entryHash(prevHash, base) };
    this.#entries.push(entry);
    return entry;
  }

  entries(): readonly AuditEntryView[] {
    return this.#entries;
  }
}
