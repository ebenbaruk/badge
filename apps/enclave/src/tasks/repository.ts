/**
 * Tasks and the excerpts considered for each one, with the decision taken for every excerpt. Excerpt text is kept
 * here (on the enclave's encrypted disk) because a consent is checked against the exact text it releases.
 */
import type { Hex } from "viem";
import { z } from "zod";
import { parseRow, parseRows, type Database } from "../db";
import { RISK_REASON_CODES, type RiskOutcome, type RiskReason } from "../policy/rules";

export const EXCERPT_DECISIONS = ["allowed", "pending", "blocked", "rejected", "expired"] as const;
export type ExcerptDecision = (typeof EXCERPT_DECISIONS)[number];

/** Why an allowed excerpt could be used. */
export const ACCESS_BASES = ["global", "own", "grant", "policy", "consent"] as const;
export type AccessBasis = (typeof ACCESS_BASES)[number];

const hex = z.custom<Hex>((value) => typeof value === "string" && /^0x[0-9a-f]*$/.test(value));

const TaskRowSchema = z.object({
  id: hex,
  requester_id: z.string(),
  task: z.string(),
  task_label: z.string(),
  full_context_of: z.string().nullable(),
  created_ms: z.number().int(),
  brief: z.string().nullable(),
  brief_ms: z.number().int().nullable(),
});
export type TaskRow = z.infer<typeof TaskRowSchema>;

const RiskReasonSchema = z.object({
  code: z.enum(RISK_REASON_CODES),
  severity: z.enum(["warn", "block"]),
  message: z.string(),
});

const ExcerptRowSchema = z.object({
  id: z.number().int(),
  task_id: hex,
  owner_id: z.string(),
  scope: z.enum(["global", "personal"]),
  source_id: z.string(),
  label: z.string(),
  text: z.string(),
  excerpt_hash: hex,
  length: z.number().int(),
  tags: z.string().transform((json) => z.array(z.string()).parse(JSON.parse(json))),
  contains_personal_data: z
    .number()
    .int()
    .transform((flag) => flag === 1),
  relevance: z.number(),
  decision: z.enum(EXCERPT_DECISIONS),
  basis: z.enum(ACCESS_BASES).nullable(),
  grant_id: hex.nullable(),
  policy_id: hex.nullable(),
  risk: z.enum(["ok", "warn", "block"]),
  risk_reasons: z.string().transform((json) => z.array(RiskReasonSchema).parse(JSON.parse(json))),
  created_ms: z.number().int(),
});
export type ExcerptRow = z.infer<typeof ExcerptRowSchema>;

export interface NewExcerpt {
  taskId: Hex;
  ownerId: string;
  scope: "global" | "personal";
  sourceId: string;
  label: string;
  text: string;
  excerptHash: Hex;
  length: number;
  tags: readonly string[];
  containsPersonalData: boolean;
  relevance: number;
  decision: ExcerptDecision;
  basis: AccessBasis | null;
  grantId: Hex | null;
  policyId: Hex | null;
  risk: RiskOutcome;
  riskReasons: readonly RiskReason[];
  nowMs: number;
}

export class TaskRepository {
  constructor(private readonly db: Database) {}

  insertTask(task: {
    id: Hex;
    requesterId: string;
    task: string;
    taskLabel: string;
    fullContextOf: string | null;
    nowMs: number;
  }): void {
    this.db
      .prepare(
        "INSERT INTO tasks (id, requester_id, task, task_label, full_context_of, created_ms) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(task.id, task.requesterId, task.task, task.taskLabel, task.fullContextOf, task.nowMs);
  }

  getTask(id: Hex): TaskRow | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id.toLowerCase());
    return row ? parseRow(TaskRowSchema, row) : undefined;
  }

  setBrief(id: Hex, brief: string, nowMs: number): void {
    this.db.prepare("UPDATE tasks SET brief = ?, brief_ms = ? WHERE id = ?").run(brief, nowMs, id);
  }

  /** Inserts an excerpt and returns its row id. */
  insertExcerpt(excerpt: NewExcerpt): number {
    const result = this.db
      .prepare(
        `INSERT INTO task_excerpts (task_id, owner_id, scope, source_id, label, text, excerpt_hash, length, tags,
           contains_personal_data, relevance, decision, basis, grant_id, policy_id, risk, risk_reasons, created_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        excerpt.taskId,
        excerpt.ownerId,
        excerpt.scope,
        excerpt.sourceId,
        excerpt.label,
        excerpt.text,
        excerpt.excerptHash.toLowerCase(),
        excerpt.length,
        JSON.stringify(excerpt.tags),
        excerpt.containsPersonalData ? 1 : 0,
        excerpt.relevance,
        excerpt.decision,
        excerpt.basis,
        excerpt.grantId,
        excerpt.policyId,
        excerpt.risk,
        JSON.stringify(excerpt.riskReasons),
        excerpt.nowMs,
      );
    return Number(result.lastInsertRowid);
  }

  excerpt(id: number): ExcerptRow | undefined {
    const row = this.db.prepare("SELECT * FROM task_excerpts WHERE id = ?").get(id);
    return row ? parseRow(ExcerptRowSchema, row) : undefined;
  }

  excerptsOf(taskId: Hex): ExcerptRow[] {
    return parseRows(
      ExcerptRowSchema,
      this.db.prepare("SELECT * FROM task_excerpts WHERE task_id = ? ORDER BY id").all(taskId.toLowerCase()),
    );
  }

  setDecision(
    id: number,
    decision: ExcerptDecision,
    basis: AccessBasis | null,
    grantId: Hex | null = null,
  ): void {
    this.db
      .prepare("UPDATE task_excerpts SET decision = ?, basis = ?, grant_id = ? WHERE id = ?")
      .run(decision, basis, grantId, id);
  }

  /**
   * Requests for `ownerId`'s personal context by someone else since `sinceMs`, across all tasks: the input of the
   * per-owner rate rule.
   */
  thirdPartyRequestsSince(ownerId: string, sinceMs: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_excerpts e JOIN tasks t ON t.id = e.task_id
         WHERE e.owner_id = ? AND e.scope = 'personal' AND t.requester_id <> e.owner_id AND e.created_ms > ?`,
      )
      .get(ownerId, sinceMs);
    return parseRow(z.object({ n: z.number().int() }), row).n;
  }
}
