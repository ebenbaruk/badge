import { describe, expect, it } from "vitest";
import type { Clock } from "../clock";
import { IN_MEMORY_DATABASE, openDatabase } from "../db";
import { canonicalJson } from "./canonical";
import { AuditLog, GENESIS_HASH, verifyChain, type AuditEntry } from "./log";

const clock: Clock = { now: () => new Date("2026-10-08T08:00:00Z") };
const HASH = `0x${"ab".repeat(32)}` as const;

function filledLog(): AuditLog {
  const log = new AuditLog(openDatabase(IN_MEMORY_DATABASE), clock);
  log.append({ type: "enroll", actor: "alice", subject: "alice", data: { address: "0xa" } });
  log.append({
    type: "consent.approved",
    actor: "bob",
    subject: HASH,
    data: { consentId: HASH, grantId: HASH, excerptHash: HASH },
  });
  log.append({
    type: "compliance.reveal",
    actor: "chloe",
    subject: "2",
    data: { auditSeq: 2, reason: "controle" },
  });
  return log;
}

describe("canonicalJson", () => {
  it("sorts keys at every level and refuses values JSON cannot carry", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"x":0,"y":1}]},"b":1}',
    );
    expect(() => canonicalJson({ n: 1n })).toThrow(TypeError);
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
  });
});

describe("audit log", () => {
  it("chains entries from the genesis hash and verifies", () => {
    const log = filledLog();
    const entries = log.all();
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0]?.prevHash).toBe(GENESIS_HASH);
    expect(entries[1]?.prevHash).toBe(entries[0]?.hash);
    expect(log.verify()).toEqual({ valid: true, length: 3, head: entries[2]?.hash });
  });

  it("detects an edited entry, a removed entry and reordered entries", () => {
    const entries = filledLog().all();
    const edited: AuditEntry[] = entries.map((e) => (e.seq === 2 ? { ...e, actor: "mallory" } : e));
    expect(verifyChain(edited)).toMatchObject({ valid: false, brokenAt: 2 });

    const removed = entries.filter((e) => e.seq !== 2);
    expect(verifyChain(removed)).toMatchObject({ valid: false, brokenAt: 3 });

    const [first, second, ...rest] = entries;
    if (!first || !second) throw new Error("log too short");
    expect(verifyChain([second, first, ...rest])).toMatchObject({ valid: false, brokenAt: 2 });

    // Recomputing the edited entry's own hash is not enough: the next entry still points at the old one.
    const rehashed = entries.map((e) => (e.seq === 2 ? { ...e, data: { ...e.data, grantId: "0x00" } } : e));
    expect(verifyChain(rehashed).valid).toBe(false);
  });

  it("is append-only in storage: UPDATE and DELETE are refused by SQLite", () => {
    const db = openDatabase(IN_MEMORY_DATABASE);
    const log = new AuditLog(db, clock);
    log.append({ type: "enroll", actor: "alice", subject: "alice", data: { address: "0xa" } });
    expect(() => db.prepare("UPDATE audit_log SET actor = 'mallory'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
  });

  it("pages entries and finds one by seq", () => {
    const log = filledLog();
    expect(log.list({ afterSeq: 1, limit: 1 }).map((e) => e.seq)).toEqual([2]);
    expect(log.get(3)?.type).toBe("compliance.reveal");
    expect(log.get(99)).toBeUndefined();
  });
});
