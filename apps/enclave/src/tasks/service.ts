/**
 * Task orchestration: an agent asks for context for a task; the enclave finds candidates across every scope, keeps
 * the relevant ones, and decides per excerpt: allowed (company context, the requester's own, an active grant, a
 * matching standing policy), pending (a ContextShare prepared for the owner's Ledger) or blocked (mass-extraction
 * rules). The brief is drafted inside the enclave, later, from allowed excerpts only.
 *
 * An agent that asks for "all of Bob's context" (a prompt-injected agent, typically) is not special-cased: its
 * request simply contains one huge excerpt and goes through the same rules and consent as any other.
 */
import {
  checkContextShare,
  encodeBadgeMessage,
  excerptLength,
  hashExcerpt,
  taskIdFrom,
  type ContextShare,
} from "@badge/consent";
import type { Hex } from "viem";
import { z } from "zod";
import { nowSeconds } from "../clock";
import { transaction } from "../db";
import type { ContextInventory, Employee } from "../directory";
import { EnclaveError } from "../errors";
import { randomBytes32, randomNonce } from "../ids";
import type { LlmClient } from "../llm/client";
import { draftBrief } from "../memory/brief";
import { classifyExcerpt, type ExcerptClassification } from "../memory/classifier";
import {
  COMPANY_OWNER_ID,
  OwnerIdSchema,
  scopeOf,
  type CandidateExcerpt,
  type MemoryStore,
} from "../memory/types";
import type { DomainContext, PolicyEngine } from "../policy/engine";
import { evaluateExtraction, type ExtractionVerdict } from "../policy/rules";
import type { Caller } from "../security/types";
import { deviceLabel, fullContextLabel } from "./labels";
import type { AccessBasis, ExcerptDecision, ExcerptRow, NewExcerpt, TaskRow } from "./repository";
import type { TokenCounter } from "./tokens";

/** A one-off consent request stays answerable for a day (the signed share itself may live up to 7 days). */
export const CONSENT_REQUEST_TTL_SECONDS = 24n * 60n * 60n;
/** Window of the per-owner request-rate rule. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_TASK_CHARS = 2_000;
const MAX_TASK_LABEL_CHARS = 200;
/** Separator between notes when an agent asks for someone's entire context. */
const FULL_CONTEXT_SEPARATOR = "\n\n";
const FULL_CONTEXT_SOURCE_PREFIX = "full-context:";

/** Body of POST /v1/tasks. */
export const CreateTaskSchema = z.strictObject({
  task: z.string().trim().min(1).max(MAX_TASK_CHARS),
  taskLabel: z.string().trim().min(1).max(MAX_TASK_LABEL_CHARS),
  /** Explicitly ask for an owner's entire context (what a trapped agent does). */
  requestFullContextOf: OwnerIdSchema.optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export type TaskStatus = "waiting_consent" | "ready";

/** What the requester learns about one excerpt: metadata only, never another owner's text. */
export interface ExcerptView {
  readonly ref: number;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly scope: "global" | "personal";
  readonly label: string;
  readonly length: number;
  readonly decision: ExcerptDecision;
  readonly basis: AccessBasis | null;
  readonly risk: ExcerptRow["risk"];
  readonly reasons: ExcerptRow["risk_reasons"];
}

export interface TaskView {
  readonly id: Hex;
  readonly status: TaskStatus;
  readonly taskLabel: string;
  readonly createdAt: string;
  readonly allowed: ExcerptView[];
  readonly pending: ExcerptView[];
  readonly blocked: ExcerptView[];
  readonly refused: ExcerptView[];
}

export interface TaskResult extends TaskView {
  /** Null while consents are pending, or when no excerpt could be used. */
  readonly brief: string | null;
  readonly tokenStats: { readonly selectedTokens: number; readonly allContextTokens: number } | null;
  readonly sources: Array<{ ownerId: string; ownerName: string; label: string; basis: AccessBasis | null }>;
}

export interface TaskServiceDeps {
  readonly ctx: DomainContext;
  readonly policy: PolicyEngine;
  readonly memory: MemoryStore;
  readonly llm: LlmClient;
  readonly inventory: ContextInventory;
  readonly countTokens: TokenCounter;
}

/** A candidate kept for the task, with its label and classification. */
interface KeptExcerpt {
  readonly candidate: Pick<CandidateExcerpt, "ownerId" | "scope" | "text" | "tags"> & { sourceId: string };
  readonly label: string;
  readonly classification: ExcerptClassification;
  readonly explicit: boolean;
}

/** Decision for one kept excerpt, computed before anything is written. */
interface Decision {
  readonly decision: ExcerptDecision;
  readonly basis: AccessBasis | null;
  readonly grantId: Hex | null;
  readonly policyId: Hex | null;
  readonly verdict: ExtractionVerdict;
}

const OK_VERDICT: ExtractionVerdict = { outcome: "ok", reasons: [] };

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  private get ctx(): DomainContext {
    return this.deps.ctx;
  }

  /** POST /v1/tasks. */
  async createTask(caller: Caller, input: CreateTaskInput): Promise<TaskView> {
    const { directory } = this.ctx;
    const requester = directory.requireEmployee(caller.employeeId);
    const requesterAddress = directory.requireAddress(requester);
    const taskLabel = deviceLabel(input.taskLabel);
    if (taskLabel.length === 0)
      throw new EnclaveError("INVALID_REQUEST", "taskLabel has no printable character");
    const taskId = taskIdFrom(taskLabel, randomBytes32());

    const kept = await this.selectExcerpts(requester, input);
    const nowMs = this.ctx.clock.now().getTime();
    const decisions = this.decide(requester, kept);

    transaction(this.ctx.db, () => {
      this.deps.policy.tasks.insertTask({
        id: taskId,
        requesterId: requester.id,
        task: input.task,
        taskLabel,
        fullContextOf: input.requestFullContextOf ?? null,
        nowMs,
      });
      kept.forEach((excerpt, index) => {
        const decision = decisions[index];
        if (!decision) throw new Error("decision missing for a kept excerpt");
        this.record(taskId, taskLabel, requester, requesterAddress, excerpt, decision, nowMs);
      });
      this.ctx.audit.append({
        type: "task.created",
        actor: requester.id,
        subject: taskId,
        data: {
          taskId,
          taskLabel,
          fullContextOf: input.requestFullContextOf ?? null,
          allowed: decisions.filter((d) => d.decision === "allowed").length,
          pending: decisions.filter((d) => d.decision === "pending").length,
          blocked: decisions.filter((d) => d.decision === "blocked").length,
        },
      });
    });
    return this.view(this.requireTask(caller, taskId));
  }

  /**
   * Candidates from memory, filtered by the relevance classifier, plus the explicitly requested full context.
   * Explicit requests skip the relevance filter (the agent asked for them by name) but nothing else.
   */
  private async selectExcerpts(requester: Employee, input: CreateTaskInput): Promise<KeptExcerpt[]> {
    const candidates = await this.deps.memory.findCandidates(input.task, { requesterId: requester.id });
    const discovered = candidates.map((c) => ({
      candidate: { ownerId: c.ownerId, scope: c.scope, text: c.text, tags: c.tags, sourceId: c.source.id },
      label: deviceLabel(c.text),
      explicit: false,
    }));
    const explicit = input.requestFullContextOf ? [this.fullContextOf(input.requestFullContextOf)] : [];
    const all = [...discovered, ...explicit];
    const classifications = await Promise.all(
      all.map(({ candidate }) => classifyExcerpt(this.deps.llm, input.task, candidate)),
    );
    return all
      .map((excerpt, index) => {
        const classification = classifications[index];
        if (!classification) throw new Error("classification missing for a candidate");
        return { ...excerpt, classification };
      })
      .filter((excerpt) => excerpt.explicit || excerpt.classification.relevant);
  }

  /** One excerpt made of every note of `ownerId`, as an agent asking for "everything" would get. */
  private fullContextOf(ownerId: string): Omit<KeptExcerpt, "classification"> {
    const owner = this.ctx.directory.requireEmployee(ownerId);
    const notes = this.deps.inventory.notesOf(owner.id);
    if (notes.length === 0) throw new EnclaveError("NOT_FOUND", `${owner.id} has no context`);
    return {
      candidate: {
        ownerId: owner.id,
        scope: scopeOf(owner.id),
        text: notes.map((note) => note.text).join(FULL_CONTEXT_SEPARATOR),
        tags: [...new Set(notes.flatMap((note) => note.tags))],
        sourceId: `${FULL_CONTEXT_SOURCE_PREFIX}${owner.id}`,
      },
      label: fullContextLabel(owner.name),
      explicit: true,
    };
  }

  /** Pure decision pass (reads only): rules first, then grant, then policy, else consent. */
  private decide(requester: Employee, kept: readonly KeptExcerpt[]): Decision[] {
    const thirdParty = kept.filter(
      (e) => e.candidate.scope === "personal" && e.candidate.ownerId !== requester.id,
    );
    const distinctOwners = new Set(thirdParty.map((e) => e.candidate.ownerId)).size;
    const requestedByOwner = new Map<string, number>();
    for (const e of thirdParty) {
      const owner = e.candidate.ownerId;
      requestedByOwner.set(owner, (requestedByOwner.get(owner) ?? 0) + excerptLength(e.candidate.text));
    }
    const sinceMs = this.ctx.clock.now().getTime() - RATE_WINDOW_MS;

    return kept.map(({ candidate, explicit }) => {
      const allowed = (basis: AccessBasis): Decision => ({
        decision: "allowed",
        basis,
        grantId: null,
        policyId: null,
        verdict: OK_VERDICT,
      });
      if (candidate.scope === "global" || candidate.ownerId === COMPANY_OWNER_ID) return allowed("global");
      if (candidate.ownerId === requester.id) return allowed("own");

      const length = excerptLength(candidate.text);
      const verdict = evaluateExtraction({
        excerptLength: length,
        ownerContextLength: this.deps.inventory.totalLength(candidate.ownerId),
        requestedFromOwnerInTask: requestedByOwner.get(candidate.ownerId) ?? length,
        distinctOwnersInTask: distinctOwners,
        ownerRequestsLastHour: this.deps.policy.tasks.thirdPartyRequestsSince(candidate.ownerId, sinceMs),
        fullContextRequest: explicit,
      });
      const base = { grantId: null, policyId: null, verdict };
      if (verdict.outcome === "block") return { ...base, decision: "blocked", basis: null };
      const owner = this.ctx.directory.employee(candidate.ownerId);
      // An owner without a Ledger can never consent: nothing of theirs leaves their scope.
      if (!owner?.address) return { ...base, decision: "blocked", basis: null };

      const grant = this.deps.policy.findActiveGrant(owner.id, requester.id, hashExcerpt(candidate.text));
      if (grant) return { ...base, decision: "allowed", basis: "grant", grantId: grant.id };
      // A warning means the owner must look at this request: a standing policy does not cover it any more.
      if (verdict.outcome === "ok") {
        const policy = this.deps.policy.findMatchingPolicy(owner.id, requester, {
          tags: candidate.tags,
          length,
        });
        if (policy) return { ...base, decision: "allowed", basis: "policy", policyId: policy.id };
      }
      return { ...base, decision: "pending", basis: null };
    });
  }

  /** Writes one excerpt, its consent request or policy use, and their audit entries (inside the transaction). */
  private record(
    taskId: Hex,
    taskLabel: string,
    requester: Employee,
    requesterAddress: `0x${string}`,
    excerpt: KeptExcerpt,
    decision: Decision,
    nowMs: number,
  ): void {
    const { candidate } = excerpt;
    const excerptHash = hashExcerpt(candidate.text);
    const length = excerptLength(candidate.text);
    const row: NewExcerpt = {
      taskId,
      ownerId: candidate.ownerId,
      scope: candidate.scope,
      sourceId: candidate.sourceId,
      label: excerpt.label,
      text: candidate.text,
      excerptHash,
      length,
      tags: candidate.tags,
      containsPersonalData: excerpt.classification.containsPersonalData,
      relevance: excerpt.classification.relevance,
      decision: decision.decision,
      basis: decision.basis,
      grantId: decision.grantId,
      policyId: decision.policyId,
      risk: decision.verdict.outcome,
      riskReasons: decision.verdict.reasons,
      nowMs,
    };
    const excerptId = this.deps.policy.tasks.insertExcerpt(row);
    const { audit } = this.ctx;
    const owner = candidate.ownerId;
    const ruleData = {
      taskId,
      owner,
      excerptHash,
      excerptLength: length,
      reasons: [...decision.verdict.reasons],
    };
    if (decision.verdict.outcome === "block")
      audit.append({ type: "rule.block", actor: "enclave", subject: owner, data: ruleData });
    if (decision.verdict.outcome === "warn")
      audit.append({ type: "rule.warn", actor: "enclave", subject: owner, data: ruleData });

    if (decision.basis === "grant" && decision.grantId) {
      audit.append({
        type: "grant.reused",
        actor: requester.id,
        subject: decision.grantId,
        data: { grantId: decision.grantId, taskId, excerptHash },
      });
    }
    if (decision.basis === "policy" && decision.policyId) {
      this.deps.policy.policies.recordUse({
        policyId: decision.policyId,
        taskId,
        recipientId: requester.id,
        excerptHash,
        nowMs,
      });
      audit.append({
        type: "policy.used",
        actor: requester.id,
        subject: decision.policyId,
        data: { policyId: decision.policyId, taskId, recipient: requester.id, excerptHash },
      });
    }
    if (decision.decision === "pending") {
      const ownerEmployee = this.ctx.directory.requireEmployee(owner);
      const message: ContextShare = {
        recipientName: this.ctx.directory.displayName(requester),
        excerptLabel: excerpt.label,
        excerptLength: length,
        taskLabel,
        expiresAt: nowSeconds(this.ctx.clock) + CONSENT_REQUEST_TTL_SECONDS,
        excerptHash,
        enclaveMeasurement: this.ctx.enclave.measurement,
        recipient: requesterAddress,
        owner: this.ctx.directory.requireAddress(ownerEmployee),
        taskId,
        nonce: randomNonce(),
      };
      // Our own message must pass the checks the owner's signature will face; failing here beats a dead request.
      checkContextShare(message, {
        now: nowSeconds(this.ctx.clock),
        enclaveMeasurement: this.ctx.enclave.measurement,
        excerptText: candidate.text,
      });
      const consentId = randomBytes32();
      this.deps.policy.consents.insert({
        id: consentId,
        task_excerpt_id: excerptId,
        task_id: taskId,
        owner_id: owner,
        recipient_id: requester.id,
        message: JSON.stringify(encodeBadgeMessage("ContextShare", message)),
        created_ms: nowMs,
      });
      audit.append({
        type: "consent.requested",
        actor: requester.id,
        subject: consentId,
        data: {
          consentId,
          taskId,
          owner,
          recipient: requester.id,
          excerptHash,
          excerptLength: length,
          risk: decision.verdict.outcome === "warn" ? "warn" : "ok",
        },
      });
    }
  }

  private requireTask(caller: Caller, taskId: Hex): TaskRow {
    const task = this.deps.policy.tasks.getTask(taskId);
    // Another employee's task is reported as missing.
    if (!task || task.requester_id !== caller.employeeId)
      throw new EnclaveError("NOT_FOUND", `no task ${taskId}`);
    return task;
  }

  private view(task: TaskRow): TaskView {
    const excerpts = this.deps.policy.tasks.excerptsOf(task.id);
    const toView = (row: ExcerptRow): ExcerptView => ({
      ref: row.id,
      ownerId: row.owner_id,
      ownerName: this.ownerName(row.owner_id),
      scope: row.scope,
      label: this.requesterLabel(task, row),
      length: row.length,
      decision: row.decision,
      basis: row.basis,
      risk: row.risk,
      reasons: row.risk_reasons,
    });
    const pending = excerpts.filter((e) => e.decision === "pending");
    return {
      id: task.id,
      status: pending.length > 0 ? "waiting_consent" : "ready",
      taskLabel: task.task_label,
      createdAt: new Date(task.created_ms).toISOString(),
      allowed: excerpts.filter((e) => e.decision === "allowed").map(toView),
      pending: pending.map(toView),
      blocked: excerpts.filter((e) => e.decision === "blocked").map(toView),
      refused: excerpts.filter((e) => e.decision === "rejected" || e.decision === "expired").map(toView),
    };
  }

  /**
   * The device label is cut from the excerpt text: the requester may only see it once the excerpt is released to
   * them. Until then they see whose context it is, not what it says.
   */
  private requesterLabel(task: TaskRow, row: ExcerptRow): string {
    const released =
      row.decision === "allowed" || row.owner_id === task.requester_id || row.scope === "global";
    return released ? row.label : `Contexte personnel de ${this.ownerName(row.owner_id)}`;
  }

  private ownerName(ownerId: string): string {
    if (ownerId === COMPANY_OWNER_ID) return this.ctx.directory.company.name;
    return this.ctx.directory.employee(ownerId)?.name ?? ownerId;
  }

  /**
   * GET /v1/tasks/:id. Once nothing is pending, drafts the brief (once, then cached) from the allowed excerpts that
   * are STILL allowed: a grant or policy revoked since the task was created no longer covers its excerpt.
   */
  async getTask(caller: Caller, taskId: Hex): Promise<TaskResult> {
    const task = this.requireTask(caller, taskId);
    for (const ownerId of new Set(this.deps.policy.tasks.excerptsOf(task.id).map((e) => e.owner_id))) {
      this.deps.policy.expirePending(ownerId);
    }
    const view = this.view(task);
    if (view.status === "waiting_consent") return { ...view, brief: null, tokenStats: null, sources: [] };

    const usable = this.deps.policy.tasks
      .excerptsOf(task.id)
      .filter((e) => e.decision === "allowed" && this.stillCovered(e));
    const sources = usable.map((e) => ({
      ownerId: e.owner_id,
      ownerName: this.ownerName(e.owner_id),
      label: e.label,
      basis: e.basis,
    }));
    if (usable.length === 0) return { ...view, brief: null, tokenStats: null, sources };

    let brief = task.brief;
    if (brief === null) {
      brief = await draftBrief(
        this.deps.llm,
        task.task,
        usable.map((e) => ({ ownerId: e.owner_id, scope: e.scope, text: e.text })),
      );
      this.deps.policy.tasks.setBrief(task.id, brief, this.ctx.clock.now().getTime());
    }
    const count = this.deps.countTokens;
    const tokenStats = {
      selectedTokens: usable.reduce((sum, e) => sum + count(e.text), 0),
      allContextTokens: this.deps.inventory.allNotes().reduce((sum, note) => sum + count(note.text), 0),
    };
    return { ...view, brief, tokenStats, sources };
  }

  /** True when the basis that allowed this excerpt is still in force (fail closed on anything unknown). */
  private stillCovered(excerpt: ExcerptRow): boolean {
    const nowMs = this.ctx.clock.now().getTime();
    switch (excerpt.basis) {
      case "global":
      case "own":
        return true;
      case "grant":
      case "consent":
        return excerpt.grant_id !== null && this.deps.policy.grants.isActive(excerpt.grant_id, nowMs);
      case "policy":
        return excerpt.policy_id !== null && this.deps.policy.policies.isActive(excerpt.policy_id, nowMs);
      default:
        return false;
    }
  }
}
