/**
 * Pure mappings from the enclave's wire shapes (@badge/client) to the web app's views. The enclave is the authority:
 * risk levels, reasons and statuses are shown as it reports them, never recomputed here. Only presentation is
 * derived (timeline wording, brief layout, UI copy).
 */
import type { AttestationResult } from "@badge/attest";
import type {
  AllowedVia,
  AuditEntry,
  AuditLog,
  ContextShareConsent,
  DeskShareConsent,
  Grant,
  Policy,
  RefusedReason,
  Risk,
  Task,
} from "@badge/client";
import { encodeBadgeMessage } from "@badge/consent";
import { keccak256, toHex, zeroHash, type Hex } from "viem";
import { z } from "zod";
import {
  DESK_IDS,
  DESK_NAMES,
  EMPLOYEES,
  isDeskId,
  isEmployeeId,
  type DeskId,
  type EmployeeId,
} from "@/lib/directory";
import { reasonForThirdParty } from "@/lib/format";
import { uniqueFindings } from "@/lib/rule-findings";
import { EnclaveError } from "../errors";
import { groupRuleAlerts } from "./alerts";
import type {
  AllowedBy,
  AttestationView,
  AuditEntryView,
  AuditView,
  BlockedExcerptView,
  BriefView,
  ConsentRequestView,
  ContextOwner,
  DeskConsentView,
  GrantView,
  PolicyView,
  RuleFinding,
  SealedIdentityView,
  SourceView,
  TaskStep,
  TaskView,
} from "./types";

const COMPANY_OWNER = "company";
const MS_PER_SECOND = 1000;
const DESK_SHARE = "desk.share";
const COMPLIANCE_REVEAL = "compliance.reveal";
/** Default title when the model's first line is already a bullet. */
const DEFAULT_BRIEF_TITLE = "Brief";

/** Unix seconds (enclave JSON) to ISO (views). */
export const isoFromSeconds = (seconds: number | bigint): string =>
  new Date(Number(seconds) * MS_PER_SECOND).toISOString();

/** Narrows an id the enclave returned to one the web directory knows; anything else is a contract break. */
export function employeeIdOf(id: string): EmployeeId {
  if (!isEmployeeId(id))
    throw new EnclaveError("INVALID_REQUEST", `unknown employee in enclave response: ${id}`);
  return id;
}

/**
 * Narrows a desk the enclave named: API routes use ids (`research`), signed messages and the consents built from them
 * use the name shown on the device (`Research`).
 */
export function deskIdOf(idOrName: string): DeskId {
  if (isDeskId(idOrName)) return idOrName;
  const byName = DESK_IDS.find((id) => DESK_NAMES[id].toLowerCase() === idOrName.toLowerCase());
  if (byName === undefined) {
    throw new EnclaveError("INVALID_REQUEST", `unknown desk in enclave response: ${idOrName}`);
  }
  return byName;
}

function ownerOf(id: string): ContextOwner {
  return id === COMPANY_OWNER ? COMPANY_OWNER : employeeIdOf(id);
}

const firstNameOf = (owner: ContextOwner): string =>
  owner === COMPANY_OWNER ? "Acme" : EMPLOYEES[owner].firstName;

const ownerNameOf = (ownerId: string): string | null => {
  const owner = ownerOf(ownerId);
  return owner === COMPANY_OWNER ? null : EMPLOYEES[owner].name;
};

const plural = (count: number, word: string): string => `${count} ${word}${count > 1 ? "s" : ""}`;

// ---- Attestation ----

/**
 * The UI badge: green only for a verified Intel TDX quote. A simulated quote (dstack simulator) passes the same
 * verification chain but carries no hardware guarantee, so it is always reported as `simulated`.
 */
export function attestationView(result: AttestationResult, checkedAt: Date): AttestationView {
  if (!result.ok) {
    throw new EnclaveError(
      "INVALID_REQUEST",
      `enclave attestation rejected (${result.code}): ${result.reason}`,
    );
  }
  const view: AttestationView = {
    mode: result.simulated ? "simulated" : result.mode,
    verified: true,
    measurement: result.enclaveMeasurement,
    tcbStatus: result.tcbStatus,
    appId: result.appId,
    warnings: result.warnings,
    checkedAt: checkedAt.toISOString(),
  };
  if (result.keyProvider !== undefined) view.keyProvider = result.keyProvider;
  return view;
}

// ---- Tasks ----

const ALLOWED_BY: Readonly<Record<AllowedVia, AllowedBy>> = {
  company: "global",
  own: "own",
  consent: "consent",
  grant_reused: "grant",
  policy: "policy",
};

const REFUSED_KIND: Readonly<Record<RefusedReason, BlockedExcerptView["kind"]>> = {
  rejected: "rejected",
  revoked: "revoked",
  expired: "expired",
};

const REFUSED_REASON_TEXT: Readonly<Record<RefusedReason, string>> = {
  rejected: "Rejected by its owner.",
  revoked: "Consent revoked by its owner: the excerpt is no longer used.",
  expired: "Request expired without an answer.",
};

export function findingsOf(risk: Risk): RuleFinding[] {
  return risk.reasons.map((reason) => ({
    rule: reason.code,
    outcome: reason.severity,
    message: reason.message,
  }));
}

const CITATION = /\s*\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;
const BULLET_PREFIX = /^(?:[-*•–]|\d+[.)])\s+/;
const RECOMMENDATION_PREFIX = /^recommendation\s*:?\s*/i;
const MARKDOWN_NOISE = /\*\*|__|^#+\s*/g;

/**
 * Lays out the brief the enclave drafted (a title line then bullets citing excerpts as `[n]`, in the order of
 * `allowed`): citations become links to the numbered sources. Out-of-range citations are dropped, never invented.
 */
export function parseBrief(text: string, sourceIds: readonly string[]): BriefView {
  const lines = text
    .split("\n")
    .map((line) => line.replace(MARKDOWN_NOISE, "").trim())
    .filter((line) => line.length > 0);
  const [first] = lines;
  const hasTitle = first !== undefined && !BULLET_PREFIX.test(first);
  const brief: BriefView = {
    title: hasTitle ? first.replace(CITATION, "") : DEFAULT_BRIEF_TITLE,
    bullets: [],
  };
  for (const line of hasTitle ? lines.slice(1) : lines) {
    const body = line.replace(BULLET_PREFIX, "");
    const cited = new Set<string>();
    for (const match of body.matchAll(CITATION)) {
      for (const number of (match[1] ?? "").split(/[,;]/)) {
        const id = sourceIds[Number(number.trim()) - 1];
        if (id !== undefined) cited.add(id);
      }
    }
    const clean = body.replace(CITATION, "").trim();
    if (clean.length === 0) continue;
    if (RECOMMENDATION_PREFIX.test(clean)) brief.recommendation = clean.replace(RECOMMENDATION_PREFIX, "");
    else brief.bullets.push({ text: clean, sourceIds: [...cited] });
  }
  return brief;
}

/** What the agent runtime remembers of a task it created (the enclave only returns its label). */
export interface TaskRecord {
  id: Hex;
  requester: EmployeeId;
  task: string;
  /** Sent with `requestFullContextOf`: the compromised-agent demo. */
  trapped: boolean;
}

/**
 * The agent's view of its task, steps included. The timeline is derived from the enclave's per-excerpt decisions
 * (the enclave reports outcomes, not a log), so only the task itself carries a time.
 */
export function taskView(task: Task, record: TaskRecord): TaskView {
  const allowed: SourceView[] = task.allowed.map((excerpt, index) => ({
    id: String(index + 1),
    owner: ownerOf(excerpt.ownerId),
    label: excerpt.excerptLabel,
    length: excerpt.excerptLength,
    allowedBy: ALLOWED_BY[excerpt.via],
  }));
  const blocked: BlockedExcerptView[] = [
    ...task.blocked.map((excerpt): BlockedExcerptView => ({
      owner: ownerOf(excerpt.ownerId),
      label: excerpt.excerptLabel,
      length: excerpt.excerptLength,
      reason: excerpt.risk.reasons.map((r) => r.message).join(" "),
      kind: "rule",
    })),
    ...task.refused.map((excerpt): BlockedExcerptView => ({
      owner: ownerOf(excerpt.ownerId),
      label: excerpt.excerptLabel,
      length: excerpt.excerptLength,
      reason: REFUSED_REASON_TEXT[excerpt.reason],
      kind: REFUSED_KIND[excerpt.reason],
    })),
  ];
  // Nothing pending and nothing released: the request ended with nothing leaving the enclave.
  const refused = task.status === "ready" && task.allowed.length === 0;
  const view: TaskView = {
    id: task.id,
    requester: record.requester,
    task: record.task,
    taskLabel: task.taskLabel,
    createdAt: isoFromSeconds(task.createdAt),
    status: refused ? "refused" : task.status,
    trapped: record.trapped,
    steps: taskSteps(task, record),
    allowed,
    pending: task.pending.map((excerpt) => ({
      consentId: excerpt.consentId,
      owner: employeeIdOf(excerpt.ownerId),
      label: excerpt.excerptLabel,
      length: excerpt.excerptLength,
      findings: findingsOf(excerpt.risk),
    })),
    blocked,
  };
  if (task.brief !== null && task.brief.length > 0) {
    view.brief = parseBrief(
      task.brief,
      allowed.map((source) => source.id),
    );
  }
  if (task.tokenStats !== null) view.tokenStats = task.tokenStats;
  return view;
}

function ownersOf(excerpts: ReadonlyArray<{ ownerId: string }>): string {
  return [...new Set(excerpts.map((e) => firstNameOf(ownerOf(e.ownerId))))].join(", ");
}

type RuleLevel = Exclude<Risk["level"], "ok">;

/**
 * One timeline step per (owner, level). The enclave evaluates each candidate excerpt on its own, so a compromised
 * agent asking for a whole context gets the same verdict once per excerpt: listed as is, one attack would read as
 * several. Steps keep the order of each group's first excerpt; reasons are the de-duplicated union.
 */
export function ruleSteps(excerpts: ReadonlyArray<{ ownerId: string; risk: Risk }>): TaskStep[] {
  const groups = new Map<string, { ownerId: string; level: RuleLevel; risks: Risk[] }>();
  for (const excerpt of excerpts) {
    const { level } = excerpt.risk;
    if (level === "ok") continue;
    const key = `${excerpt.ownerId}\u0000${level}`;
    const group = groups.get(key) ?? { ownerId: excerpt.ownerId, level, risks: [] };
    group.risks.push(excerpt.risk);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ ownerId, level, risks }): TaskStep => {
    const owner = firstNameOf(ownerOf(ownerId));
    // Reasons address the owner ("your context"); this timeline is the requester's, so they name the owner.
    const reasons = uniqueFindings(risks.flatMap(findingsOf)).map((finding) =>
      reasonForThirdParty(finding.message, ownerNameOf(ownerId)),
    );
    const count = risks.length > 1 ? ` (${risks.length} excerpts)` : "";
    return {
      kind: level === "block" ? "rule_block" : "rule_warn",
      title:
        level === "block"
          ? `Blocked by the rules before reaching ${owner}`
          : `Flagged to ${owner} by enclave rules`,
      detail: `${reasons.join(" ")}${count}`,
    };
  });
}

function taskSteps(task: Task, record: TaskRecord): TaskStep[] {
  const steps: TaskStep[] = [
    record.trapped
      ? {
          kind: "search",
          at: isoFromSeconds(task.createdAt),
          title: "The agent asks for an entire personal context",
          detail: "No task-scoped search: the request goes through the rules and the owner.",
        }
      : {
          kind: "search",
          at: isoFromSeconds(task.createdAt),
          title: "Searching the enclave's memory",
          detail: "Company context and personal contexts, without anything leaving.",
        },
  ];
  const byVia = (via: AllowedVia) => task.allowed.filter((e) => e.via === via);
  const direct = [...byVia("company"), ...byVia("own")];
  if (direct.length > 0) {
    steps.push({
      kind: "allowed",
      title: `${plural(direct.length, "excerpt")} allowed by default`,
      detail: "The company context and your own notes.",
    });
  }
  const reused = byVia("grant_reused");
  if (reused.length > 0) {
    steps.push({
      kind: "allowed",
      title: `${plural(reused.length, "excerpt")} already granted`,
      detail: `One-off consent still valid: ${ownersOf(reused)}.`,
    });
  }
  const viaPolicy = byVia("policy");
  if (viaPolicy.length > 0) {
    steps.push({
      kind: "policy",
      title: `Standing agreement from ${ownersOf(viaPolicy)}`,
      detail: `${plural(viaPolicy.length, "excerpt")} with no new signature; every use is logged.`,
    });
  }
  steps.push(...ruleSteps([...task.pending, ...task.blocked]));
  const consented = byVia("consent");
  if (consented.length > 0) {
    steps.push({
      kind: "consent_received",
      title: `Consent signed on ${ownersOf(consented)}'s Ledger`,
      detail: plural(consented.length, "excerpt"),
    });
  }
  for (const excerpt of task.refused) {
    steps.push({
      kind: "consent_rejected",
      title:
        excerpt.reason === "rejected"
          ? `${firstNameOf(ownerOf(excerpt.ownerId))} rejected the share`
          : excerpt.reason === "revoked"
            ? `${firstNameOf(ownerOf(excerpt.ownerId))} revoked their consent`
            : "Request expired",
      detail: excerpt.excerptLabel,
    });
  }
  if (task.pending.length > 0) {
    steps.push({
      kind: "waiting_consent",
      title: `Waiting for consent from ${ownersOf(task.pending)}`,
      detail: "On their Ledger, which shows in clear what would leave and for whom.",
    });
  } else if (task.allowed.length === 0) {
    steps.push({
      kind: "refused",
      title: "No context allowed: nothing left the enclave",
      detail: "No excerpt was injected into the model.",
    });
  } else if (task.brief !== null) {
    steps.push({
      kind: "brief",
      title: "Brief drafted inside the enclave",
      detail: `From the ${plural(task.allowed.length, "allowed source")}, and from them alone.`,
    });
  }
  return steps;
}

// ---- Consents ----

export function consentView(consent: ContextShareConsent, owner: EmployeeId): ConsentRequestView {
  return {
    id: consent.id,
    taskId: consent.taskId,
    owner,
    requester: employeeIdOf(consent.requester.id),
    taskLabel: consent.message.taskLabel,
    createdAt: isoFromSeconds(consent.createdAt),
    status: consent.status,
    findings: findingsOf(consent.risk),
    message: encodeBadgeMessage("ContextShare", consent.message),
    excerpt: { text: consent.excerpt.text, tags: consent.excerpt.tags },
  };
}

export function deskConsentView(consent: DeskShareConsent, owner: EmployeeId): DeskConsentView {
  return {
    id: consent.id,
    owner,
    fromDesk: deskIdOf(consent.recipientDesk),
    ruleLabel: consent.ruleLabel,
    createdAt: isoFromSeconds(consent.createdAt),
    status: consent.status,
    message: encodeBadgeMessage("DeskShare", consent.message),
  };
}

// ---- Grants and policies ----

export function policyView(policy: Policy, owner: EmployeeId): PolicyView {
  return {
    id: policy.id,
    owner,
    granteeTeam: policy.granteeTeam,
    contextTag: policy.contextTag,
    purpose: policy.purpose,
    maxExcerptLength: policy.maxExcerptLength,
    createdAt: isoFromSeconds(policy.createdAt),
    expiresAt: isoFromSeconds(policy.expiresAt),
    uses: policy.uses,
    status: policy.status,
  };
}

/** One-off grants (active ones only: the enclave lists what can still be revoked) and standing agreements. */
export function grantViews(
  grants: readonly Grant[],
  policies: readonly PolicyView[],
  owner: EmployeeId,
): GrantView[] {
  const shares = grants.map((grant): GrantView => {
    const recipient = employeeIdOf(grant.recipient.id);
    return {
      id: grant.id,
      kind: "share",
      owner,
      recipient,
      recipientLabel: EMPLOYEES[recipient].name,
      label: `${grant.excerptLabel} · ${grant.taskLabel}`,
      createdAt: isoFromSeconds(grant.createdAt),
      expiresAt: isoFromSeconds(grant.expiresAt),
      status: "active",
    };
  });
  const agreements = policies.map((policy): GrantView => ({
    id: policy.id,
    kind: "policy",
    owner,
    recipientLabel: `${policy.granteeTeam} team`,
    label: `${policy.contextTag} · ${policy.purpose}`,
    createdAt: policy.createdAt,
    expiresAt: policy.expiresAt,
    uses: policy.uses,
    status: policy.status,
  }));
  return [...shares, ...agreements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---- Audit ----

const deskShareDataSchema = z.object({
  sourceDesk: z.string(),
  recipientDesk: z.string(),
  sealedSigner: z.object({ ciphertext: z.string() }).loose(),
});
const revealDataSchema = z.object({ auditSeq: z.number().int() });

function entryView(entry: AuditEntry): AuditEntryView {
  return { ...entry, ts: isoFromSeconds(entry.ts) };
}

/** Short, stable fingerprint of a sealed box for display (its ciphertext means nothing to a reader). */
export function sealedFingerprint(ciphertext: string): Hex {
  return keccak256(toHex(ciphertext));
}

/**
 * The compliance view of the log. `revealedSigners` holds what this officer's bridge decrypted earlier (the enclave
 * only logs that an entry was opened, never by whom it was signed).
 */
export function auditView(log: AuditLog, revealedSigners: ReadonlyMap<number, EmployeeId>): AuditView {
  const entries = log.entries.map(entryView);
  const reveals = new Map<number, string>();
  for (const entry of entries) {
    if (entry.type !== COMPLIANCE_REVEAL) continue;
    const data = revealDataSchema.safeParse(entry.data);
    if (data.success && !reveals.has(data.data.auditSeq)) reveals.set(data.data.auditSeq, entry.ts);
  }
  const sealed: SealedIdentityView[] = [];
  for (const entry of entries) {
    if (entry.type !== DESK_SHARE) continue;
    const data = deskShareDataSchema.parse(entry.data);
    const view: SealedIdentityView = {
      seq: entry.seq,
      ts: entry.ts,
      sourceDesk: deskIdOf(data.sourceDesk),
      label: `To the ${isDeskId(data.recipientDesk) ? DESK_NAMES[data.recipientDesk] : data.recipientDesk} desk`,
      sealed: sealedFingerprint(data.sealedSigner.ciphertext),
    };
    const revealedAt = reveals.get(entry.seq);
    if (revealedAt !== undefined) {
      const employee = revealedSigners.get(entry.seq);
      view.revealed = employee === undefined ? { revealedAt } : { employee, revealedAt };
    }
    sealed.push(view);
  }
  const brokenAt = log.chain.brokenAt;
  return {
    entries,
    chain: {
      ok: log.chain.valid,
      length: log.chain.length,
      headHash: entries.at(-1)?.hash ?? zeroHash,
      ...(brokenAt === null ? {} : { brokenAt }),
    },
    alerts: groupRuleAlerts(entries),
    sealed,
  };
}
