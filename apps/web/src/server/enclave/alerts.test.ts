import { describe, expect, it } from "vitest";
import { groupRuleAlerts } from "./alerts";
import type { AuditEntryView } from "./types";

const TASK_A = `0x${"aa".repeat(32)}`;
const TASK_B = `0x${"bb".repeat(32)}`;
const FULL = {
  code: "FULL_CONTEXT_REQUEST",
  severity: "warn",
  message: "The task asks for 100% of your context.",
};
const LONG = { code: "EXCERPT_LENGTH", severity: "warn", message: "Unusually long excerpt." };

let seq = 0;
function entry(type: string, actor: string, subject: string, data: Record<string, unknown>): AuditEntryView {
  seq += 1;
  return {
    seq,
    ts: new Date(Date.UTC(2026, 9, 8, 10, 0, seq)).toISOString(),
    type,
    actor,
    subject,
    data,
    prevHash: `h${seq - 1}`,
    hash: `h${seq}`,
  };
}

/** Shape the enclave logs: actor "enclave", subject the owner, task in `data.taskId`. */
const ruleEntry = (type: string, taskId: string, owner: string, reasons: unknown[]) =>
  entry(type, "enclave", owner, { taskId, owner, excerptHash: "0x01", excerptLength: 100, reasons });

describe("groupRuleAlerts", () => {
  it("turns one request's per-excerpt entries into one alert with the union of reasons", () => {
    const entries = [
      entry("task.created", "alice", TASK_A, { taskId: TASK_A, taskLabel: "brief", fullContextOf: "bob" }),
      ruleEntry("rule.warn", TASK_A, "bob", [FULL, LONG]),
      ruleEntry("rule.warn", TASK_A, "bob", [FULL]),
      ruleEntry("rule.warn", TASK_A, "bob", [FULL]),
      ruleEntry("rule.warn", TASK_A, "bob", [FULL]),
    ];
    const alerts = groupRuleAlerts(entries);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({
      seq: entries[4]?.seq,
      ts: entries[4]?.ts,
      level: "warn",
      taskId: TASK_A,
      requester: "alice",
      owner: "bob",
      excerpts: 4,
      reasons: [
        { code: FULL.code, message: FULL.message },
        { code: LONG.code, message: LONG.message },
      ],
    });
  });

  it("keeps the most severe level of a group", () => {
    const alerts = groupRuleAlerts([
      ruleEntry("rule.warn", TASK_A, "bob", [FULL]),
      ruleEntry("rule.block", TASK_A, "bob", [LONG]),
      ruleEntry("rule.warn", TASK_A, "bob", [FULL]),
    ]);
    expect(alerts.map((a) => [a.level, a.excerpts])).toEqual([["block", 3]]);
  });

  it("keeps distinct requests and owners apart, in log order, and ignores other events", () => {
    const alerts = groupRuleAlerts([
      ruleEntry("rule.warn", TASK_A, "bob", [FULL]),
      entry("consent.approved", "bob", "0x02", {}),
      ruleEntry("rule.warn", TASK_A, "chloe", [FULL]),
      ruleEntry("rule.warn", TASK_B, "bob", [FULL]),
    ]);
    expect(alerts.map((a) => [a.taskId, a.owner])).toEqual([
      [TASK_A, "bob"],
      [TASK_A, "chloe"],
      [TASK_B, "bob"],
    ]);
    expect(alerts.every((a) => a.requester === null)).toBe(true);
  });

  it("reads the mock's shape: requester as actor, task as subject", () => {
    const alerts = groupRuleAlerts([
      entry("rule.warn", "alice", TASK_A, { owner: "bob", reasons: [FULL] }),
      entry("rule.warn", "alice", TASK_A, { owner: "bob", reasons: [FULL] }),
    ]);
    expect(alerts).toMatchObject([{ taskId: TASK_A, requester: "alice", owner: "bob", excerpts: 2 }]);
  });

  it("never merges enclave entries that name no task, and tolerates malformed reasons", () => {
    const orphan = () => entry("rule.warn", "enclave", "bob", { owner: "bob", reasons: "garbled" });
    const alerts = groupRuleAlerts([orphan(), orphan()]);
    expect(alerts.map((a) => [a.taskId, a.excerpts, a.reasons])).toEqual([
      [null, 1, []],
      [null, 1, []],
    ]);
  });
});
