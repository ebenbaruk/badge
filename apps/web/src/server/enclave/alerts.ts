/**
 * Compliance alerts derived from the audit log. Presentation only: the chained log keeps one entry per evaluated
 * excerpt, and this groups them so one request reads as one alert.
 */
import { z } from "zod";
import { isEmployeeId, type EmployeeId } from "@/lib/directory";
import { reasonKey } from "@/lib/rule-findings";
import type { AuditEntryView, RuleAlertReason, RuleAlertView } from "./types";

const RULE_WARN = "rule.warn";
const RULE_BLOCK = "rule.block";
const TASK_CREATED = "task.created";

const ruleReasonsSchema = z.array(z.object({ code: z.string(), message: z.string().optional() }));
const stringField = (value: unknown): string | null => (typeof value === "string" ? value : null);
const employeeField = (value: unknown): EmployeeId | null =>
  typeof value === "string" && isEmployeeId(value) ? value : null;

/**
 * The task an entry belongs to. The enclave logs it as `data.taskId` (its subject is the owner); the mock logs it as
 * the subject. Without either, the entry stays alone rather than being merged with an unrelated one.
 */
function taskIdOf(entry: AuditEntryView): string | null {
  return stringField(entry.data.taskId) ?? (entry.actor === "enclave" ? null : entry.subject);
}

/**
 * Groups `rule.warn` / `rule.block` entries by (task, owner): the enclave evaluates each candidate excerpt
 * separately, so one compromised agent asking for a whole context logs one entry per excerpt. Each group keeps the
 * most severe level and the de-duplicated union of reasons. Groups come in log order of their first entry.
 *
 * The enclave logs rule entries as `actor: "enclave"`; the requester is then read from the task's `task.created`
 * entry, whose actor is the requesting employee.
 */
export function groupRuleAlerts(entries: readonly AuditEntryView[]): RuleAlertView[] {
  const requesterOfTask = new Map<string, EmployeeId>();
  for (const entry of entries) {
    if (entry.type !== TASK_CREATED) continue;
    const taskId = stringField(entry.data.taskId) ?? entry.subject;
    const requester = employeeField(entry.actor);
    if (requester !== null) requesterOfTask.set(taskId, requester);
  }

  const groups = new Map<string, { alert: RuleAlertView; reasonKeys: Set<string> }>();
  for (const entry of entries) {
    if (entry.type !== RULE_WARN && entry.type !== RULE_BLOCK) continue;
    const taskId = taskIdOf(entry);
    const owner = employeeField(entry.data.owner);
    const key = taskId === null ? `seq:${entry.seq}` : `${taskId}\u0000${owner ?? ""}`;
    const level = entry.type === RULE_BLOCK ? "block" : "warn";
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        alert: {
          seq: entry.seq,
          ts: entry.ts,
          level,
          taskId,
          requester:
            employeeField(entry.actor) ?? (taskId === null ? null : (requesterOfTask.get(taskId) ?? null)),
          owner,
          excerpts: 0,
          reasons: [],
        },
        reasonKeys: new Set(),
      };
      groups.set(key, group);
    }
    const { alert, reasonKeys } = group;
    alert.excerpts += 1;
    if (entry.seq > alert.seq) {
      alert.seq = entry.seq;
      alert.ts = entry.ts;
    }
    if (level === "block") alert.level = "block";
    const parsed = ruleReasonsSchema.safeParse(entry.data.reasons);
    for (const reason of parsed.success ? parsed.data : []) {
      const reasonId = reasonKey(reason.code, reason.message);
      if (reasonKeys.has(reasonId)) continue;
      reasonKeys.add(reasonId);
      const kept: RuleAlertReason = { code: reason.code };
      if (reason.message !== undefined) kept.message = reason.message;
      alert.reasons.push(kept);
    }
  }
  return [...groups.values()].map((group) => group.alert);
}
