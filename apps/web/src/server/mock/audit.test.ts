import { describe, expect, it } from "vitest";
import { AuditLog, canonicalJson, GENESIS_HASH, verifyChain } from "./audit";

describe("audit log", () => {
  it("canonicalises key order recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"e":0,"f":1}]},"b":1}',
    );
  });

  it("chains entries and verifies the chain", () => {
    const log = new AuditLog();
    log.append({ type: "task.created", actor: "alice", subject: "t1", data: { taskLabel: "brief Orion" } });
    log.append({ type: "consent.approved", actor: "bob", subject: "c1", data: { grantId: "0x01" } });
    const entries = log.entries();
    expect(entries[0]?.prevHash).toBe(GENESIS_HASH);
    expect(entries[1]?.prevHash).toBe(entries[0]?.hash);
    expect(verifyChain(entries)).toMatchObject({ ok: true, length: 2, headHash: entries[1]?.hash });
  });

  it("detects a rewritten entry", () => {
    const log = new AuditLog();
    log.append({ type: "rule.warn", actor: "alice", subject: "t1", data: { owner: "bob" } });
    log.append({ type: "consent.rejected", actor: "bob", subject: "c1", data: {} });
    const [first, second] = log.entries();
    if (first === undefined || second === undefined) throw new Error("expected two entries");
    const tampered = [{ ...first, data: { owner: "chloe" } }, second];
    expect(verifyChain(tampered)).toMatchObject({ ok: false, brokenAt: 1 });
  });
});
