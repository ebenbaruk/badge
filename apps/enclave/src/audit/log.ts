/**
 * The compliance log: an append-only hash chain. Each entry's hash covers the previous hash and the canonical
 * form of the entry, so removing, reordering or editing any entry breaks every later hash. `verifyChain` lets the
 * compliance officer (and the tests) check this independently of the storage.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../clock";
import { parseRow, parseRows, type Database } from "../db";
import { canonicalJson } from "./canonical";
import { AUDIT_EVENT_TYPES, type AuditEvent, type AuditEventType } from "./events";

/** prevHash of the first entry. */
export const GENESIS_HASH = "0".repeat(64);
/** Default and maximum page size of {@link AuditLog.list}. */
export const AUDIT_PAGE_SIZE = 500;

export interface AuditEntry {
  readonly seq: number;
  readonly ts: number;
  readonly type: AuditEventType;
  readonly actor: string;
  readonly subject: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly hash: string;
}

const AuditRowSchema = z.object({
  seq: z.number().int(),
  ts_ms: z.number().int(),
  type: z.enum(AUDIT_EVENT_TYPES),
  actor: z.string(),
  subject: z.string(),
  data: z.string(),
  prev_hash: z.string(),
  hash: z.string(),
});

/** sha256(prevHash | canonical(entry without hashes)), hex. */
export function hashAuditEntry(entry: Omit<AuditEntry, "hash">): string {
  const body = canonicalJson({
    seq: entry.seq,
    ts: entry.ts,
    type: entry.type,
    actor: entry.actor,
    subject: entry.subject,
    data: entry.data,
  });
  return createHash("sha256").update(`${entry.prevHash}|${body}`).digest("hex");
}

export type ChainVerification =
  | { readonly valid: true; readonly length: number; readonly head: string }
  | { readonly valid: false; readonly brokenAt: number; readonly reason: string };

/**
 * Verifies a full chain, from the genesis entry, in sequence order.
 * Pure: works on entries read from the database, exported to a file, or tampered with in a test.
 */
export function verifyChain(entries: readonly AuditEntry[]): ChainVerification {
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const entry of entries) {
    if (entry.seq !== expectedSeq) {
      return { valid: false, brokenAt: entry.seq, reason: `expected seq ${expectedSeq}, found ${entry.seq}` };
    }
    if (entry.prevHash !== prevHash) {
      return { valid: false, brokenAt: entry.seq, reason: "prevHash does not match the previous entry" };
    }
    if (hashAuditEntry(entry) !== entry.hash) {
      return { valid: false, brokenAt: entry.seq, reason: "hash does not match the entry content" };
    }
    prevHash = entry.hash;
    expectedSeq++;
  }
  return { valid: true, length: entries.length, head: prevHash };
}

export class AuditLog {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Appends an event and returns the stored entry. Synchronous so that it can join the caller's transaction:
   * the event is recorded if and only if the action it describes is.
   */
  append(event: AuditEvent): AuditEntry {
    const head = this.db.prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1").get();
    const last = head ? parseRow(z.object({ seq: z.number().int(), hash: z.string() }), head) : undefined;
    // Round-trip through JSON so the hashed form is exactly what is stored and read back.
    const data = JSON.parse(JSON.stringify(event.data)) as Record<string, unknown>;
    const unhashed = {
      seq: (last?.seq ?? 0) + 1,
      ts: this.clock.now().getTime(),
      type: event.type,
      actor: event.actor,
      subject: event.subject,
      data,
      prevHash: last?.hash ?? GENESIS_HASH,
    };
    const entry: AuditEntry = { ...unhashed, hash: hashAuditEntry(unhashed) };
    this.db
      .prepare(
        "INSERT INTO audit_log (seq, ts_ms, type, actor, subject, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        entry.seq,
        entry.ts,
        entry.type,
        entry.actor,
        entry.subject,
        JSON.stringify(entry.data),
        entry.prevHash,
        entry.hash,
      );
    return entry;
  }

  /** Entries with seq > `afterSeq`, oldest first. */
  list(options: { afterSeq?: number; limit?: number } = {}): AuditEntry[] {
    const limit = Math.min(options.limit ?? AUDIT_PAGE_SIZE, AUDIT_PAGE_SIZE);
    const rows = this.db
      .prepare("SELECT * FROM audit_log WHERE seq > ? ORDER BY seq LIMIT ?")
      .all(options.afterSeq ?? 0, limit);
    return parseRows(AuditRowSchema, rows).map(toEntry);
  }

  /** The whole chain, oldest first (for verification). */
  all(): AuditEntry[] {
    return parseRows(AuditRowSchema, this.db.prepare("SELECT * FROM audit_log ORDER BY seq").all()).map(
      toEntry,
    );
  }

  get(seq: number): AuditEntry | undefined {
    const row = this.db.prepare("SELECT * FROM audit_log WHERE seq = ?").get(seq);
    return row ? toEntry(parseRow(AuditRowSchema, row)) : undefined;
  }

  verify(): ChainVerification {
    return verifyChain(this.all());
  }
}

function toEntry(row: z.infer<typeof AuditRowSchema>): AuditEntry {
  return {
    seq: row.seq,
    ts: row.ts_ms,
    type: row.type,
    actor: row.actor,
    subject: row.subject,
    data: JSON.parse(row.data) as Record<string, unknown>,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}
