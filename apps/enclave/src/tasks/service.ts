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
import type { AllowedVia, Task } from "@badge/client";
import type { Hex } from "viem";
import { z } from "zod";
import { msToUnixSeconds, nowSeconds } from "../clock";
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
import { servesTask } from "./selection";
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

/** How an access basis (storage) is reported to the requester (API). */
const ALLOWED_VIA_BY_BASIS: Record<AccessBasis, AllowedVia> = {
  global: "company",
  own: "own",
  consent: "consent",
  grant: "grant_reused",
  policy: "policy",
};

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

/** Blocks a request for the context of someone who has no Ledger, saying why (shown to the requester). */
function withoutLedger(verdict: ExtractionVerdict): ExtractionVerdict {
  return {
    outcome: "block",
    reasons: [
      ...verdict.reasons,
      {
        code: "OWNER_CANNOT_CONSENT",
        severity: "block",
        message: "Le propriétaire n'a pas de Ledger : son contexte ne peut pas être partagé.",
      },
    ],
  };
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  private get ctx(): DomainContext {
    return this.deps.ctx;
  }

  /** POST /v1/tasks. Answers like GET /v1/tasks/:id (with the brief when nothing needs a consent). */
  async createTask(caller: Caller, input: CreateTaskInput): Promise<Task> {
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
    return this.getTask(caller, taskId);
  }

  /**
   * Candidates from memory, kept by the selection gate (`servesTask`: classifier relevance and confidence, no
   * colleague's personal matters), plus the explicitly requested full context. Explicit requests skip the gate (the
   * agent asked for them by name, and the owner must see that) but nothing else.
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
      .filter(
        (excerpt) => excerpt.explicit || servesTask(excerpt.candidate, excerpt.classification, requester.id),
      );
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
      if (!owner?.address) {
        return { ...base, verdict: withoutLedger(verdict), decision: "blocked", basis: null };
      }

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

  /**
   * The device label is cut from the excerpt text: the requester may only see it once the excerpt is released to
   * them. Until then they see whose context it is, not what it says.
   */
  private requesterLabel(task: TaskRow, row: ExcerptRow, released: boolean): string {
    const visible = released || row.owner_id === task.requester_id || row.scope === "global";
    return visible ? row.label : `Contexte personnel de ${this.ownerName(row.owner_id)}`;
  }

  private ownerName(ownerId: string): string {
    if (ownerId === COMPANY_OWNER_ID) return this.ctx.directory.company.name;
    return this.ctx.directory.employee(ownerId)?.name ?? ownerId;
  }

  /**
   * GET /v1/tasks/:id. Sorts every excerpt into allowed / pending / blocked / refused and, once nothing is pending,
   * drafts the brief from the excerpts that are STILL allowed: a grant or policy revoked since the task was created
   * no longer covers its excerpt (it is reported as refused, reason "revoked"). The brief is cached together with
   * the excerpts it was drafted from, and redrafted when that set changes, so a revocation also reaches old briefs.
   */
  async getTask(caller: Caller, taskId: Hex): Promise<Task> {
    const task = this.requireTask(caller, taskId);
    const owners = new Set(this.deps.policy.tasks.excerptsOf(task.id).map((e) => e.owner_id));
    for (const ownerId of owners) this.deps.policy.expirePending(ownerId);

    const allowed: Task["allowed"] = [];
    const pending: Task["pending"] = [];
    const blocked: Task["blocked"] = [];
    const refused: Task["refused"] = [];
    const usable: ExcerptRow[] = [];
    for (const row of this.deps.policy.tasks.excerptsOf(task.id)) {
      const base = (released: boolean) => ({
        ownerId: row.owner_id,
        ownerName: this.ownerName(row.owner_id),
        excerptLabel: this.requesterLabel(task, row, released),
        excerptLength: row.length,
      });
      const risk = { level: row.risk, reasons: [...row.risk_reasons] };
      switch (row.decision) {
        case "allowed":
          if (row.basis !== null && this.stillCovered(row)) {
            usable.push(row);
            allowed.push({ ...base(true), via: ALLOWED_VIA_BY_BASIS[row.basis] });
          } else {
            refused.push({ ...base(false), reason: "revoked" });
          }
          break;
        case "pending":
          pending.push({ ...base(false), consentId: this.requireConsentId(row), risk });
          break;
        case "blocked":
          blocked.push({ ...base(false), risk });
          break;
        case "rejected":
        case "expired":
          refused.push({ ...base(false), reason: row.decision });
          break;
      }
    }

    const ready = pending.length === 0 && usable.length > 0;
    const view = {
      id: task.id,
      taskLabel: task.task_label,
      status: pending.length > 0 ? ("waiting_consent" as const) : ("ready" as const),
      allowed,
      pending,
      blocked,
      refused,
      createdAt: msToUnixSeconds(task.created_ms),
    };
    if (!ready) return { ...view, brief: null, tokenStats: null };
    return { ...view, brief: await this.brief(task, usable), tokenStats: this.tokenStats(usable) };
  }

  /** The cached brief when it was drafted from exactly `usable`, else a fresh draft (cached in turn). */
  private async brief(task: TaskRow, usable: readonly ExcerptRow[]): Promise<string> {
    const sources = usable.map((e) => e.id);
    if (task.brief !== null && sameIds(task.brief_sources, sources)) return task.brief;
    const brief = await draftBrief(
      this.deps.llm,
      task.task,
      usable.map((e) => ({ ownerId: e.owner_id, scope: e.scope, text: e.text })),
    );
    this.deps.policy.tasks.setBrief(task.id, brief, sources, this.ctx.clock.now().getTime());
    return brief;
  }

  private tokenStats(usable: readonly ExcerptRow[]): Task["tokenStats"] {
    const count = this.deps.countTokens;
    return {
      selectedTokens: usable.reduce((sum, e) => sum + count(e.text), 0),
      allContextTokens: this.deps.inventory.allNotes().reduce((sum, note) => sum + count(note.text), 0),
    };
  }

  private requireConsentId(row: ExcerptRow): Hex {
    const consent = this.deps.policy.consents.byTaskExcerpt(row.id);
    // A pending excerpt always has its consent request (same transaction); a miss is corrupted state.
    if (!consent) throw new Error(`pending excerpt ${row.id} has no consent request`);
    return consent.id;
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

function sameIds(a: readonly number[] | null, b: readonly number[]): boolean {
  return a !== null && a.length === b.length && a.every((id, index) => id === b[index]);
}
