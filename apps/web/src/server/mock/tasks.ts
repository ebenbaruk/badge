/**
 * Mock of the enclave's task pipeline (docs/enclave-api.md, flows 3 to 5): retrieval, classification, policy
 * engine (global / own / grant / standing agreement / consent), mass-extraction rules, consents and the brief.
 */
import {
  checkContextPolicy,
  checkContextShare,
  ConsentError,
  encodeBadgeMessage,
  excerptLength,
  hashBadgeMessage,
  hashExcerpt,
  taskIdFrom,
  toDeviceAscii,
  type ContextShare,
} from "@badge/consent";
import type { Hex } from "viem";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { estimateTokens, plural } from "@/lib/format";
import { EnclaveError } from "../errors";
import { deviceLabel, deviceName, newNonce } from "../messages";
import type {
  ConsentRequestView,
  ContextOwner,
  CreateTaskInput,
  RuleFinding,
  TaskStatus,
  TaskView,
} from "../enclave/types";
import { draftBrief } from "./brief";
import { findCandidates, isExcludedPersonalData } from "./retrieval";
import { evaluateExtraction } from "./rules";
import type { SeedNote } from "./seed";
import {
  addStep,
  consumeNonce,
  nowSeconds,
  randomBytes32,
  verifySignedBy,
  type ConsentRecord,
  type MockState,
  type TaskRecord,
  type TaskSource,
} from "./state";

/** Consent requests prepared by the enclave expire after 24 h (contract: expiresAt = now + 24 h). */
export const CONSENT_TTL_SECONDS = 24n * 3600n;
const HOUR_MS = 3_600_000;
const EXCERPT_SEPARATOR = "\n\n";

function ownerName(owner: ContextOwner): string {
  return owner === "company" ? "Acme" : EMPLOYEES[owner].name;
}

function sourceFromNotes(
  id: string,
  owner: ContextOwner,
  label: string,
  notes: readonly SeedNote[],
  allowedBy: TaskSource["allowedBy"],
): TaskSource {
  const text = notes.map((n) => n.text).join(EXCERPT_SEPARATOR);
  return {
    id,
    owner,
    label,
    length: excerptLength(text),
    allowedBy,
    text,
    noteIds: notes.map((n) => n.id),
    noteTexts: notes.map((n) => n.text),
  };
}

function bundleLabel(owner: EmployeeId, notes: readonly SeedNote[]): string {
  const [first] = notes;
  if (notes.length === 1 && first !== undefined) return first.label;
  return `Notes de ${EMPLOYEES[owner].firstName} (${notes.length})`;
}

function ownerTotalLength(state: MockState, owner: EmployeeId): number {
  return excerptLength(
    state.seed.notes
      .filter((n) => n.owner === owner)
      .map((n) => n.text)
      .join(EXCERPT_SEPARATOR),
  );
}

function recentRequests(state: MockState, owner: EmployeeId, nowMs: number): number {
  const recent = (state.requestLog.get(owner) ?? []).filter((at) => nowMs - at < HOUR_MS);
  state.requestLog.set(owner, recent);
  return recent.length;
}

function activePolicyFor(state: MockState, owner: EmployeeId, requester: EmployeeId, note: SeedNote) {
  const team = toDeviceAscii(EMPLOYEES[requester].team);
  const tags = new Set(note.tags.map((t) => toDeviceAscii(t)));
  for (const record of state.policies.values()) {
    if (record.owner !== owner || record.revokedAt !== undefined) continue;
    if (record.policy.granteeTeam !== team || !tags.has(record.policy.contextTag)) continue;
    try {
      // Same intrinsic checks as at creation, plus the per-excerpt cap: an expired policy silently stops applying.
      checkContextPolicy(record.policy, {
        now: nowSeconds(),
        enclaveMeasurement: state.measurement,
        excerptText: note.text,
      });
      return record;
    } catch (error) {
      // An expired policy or a note above its cap simply does not cover this note; anything else is a bug.
      if (!(error instanceof ConsentError)) throw error;
    }
  }
  return undefined;
}

function activeGrantFor(state: MockState, owner: EmployeeId, requester: EmployeeId, excerptHash: Hex) {
  const now = nowSeconds();
  for (const grant of state.grants.values()) {
    if (
      grant.owner === owner &&
      grant.recipient === requester &&
      grant.excerptHash === excerptHash &&
      grant.revokedAt === undefined &&
      grant.expiresAt > now
    ) {
      return grant;
    }
  }
  return undefined;
}

interface ForeignRequest {
  owner: EmployeeId;
  notes: SeedNote[];
  label: string;
  distinctOwners: number;
  fullContextRequest: boolean;
}

/** Rule findings as the enclave logs them (`reasons`), so the compliance view reads one format. */
function auditReasons(findings: readonly RuleFinding[]) {
  return findings.map((f) => ({ code: f.rule, severity: f.outcome, message: f.message }));
}

/** Grant reuse, else rules, else a pending consent prepared with the exact ContextShare to sign. */
function requestForeignExcerpt(state: MockState, task: TaskRecord, request: ForeignRequest): void {
  const { owner, notes, label } = request;
  const source = sourceFromNotes(`${task.id}:${owner}`, owner, label, notes, "grant");
  const excerptHash = hashExcerpt(source.text);
  const grant = activeGrantFor(state, owner, task.requester, excerptHash);
  if (grant !== undefined) {
    grant.uses += 1;
    task.allowed.push(source);
    state.audit.append({
      type: "grant.reused",
      actor: task.requester,
      subject: grant.id,
      data: { taskId: task.id, excerptHash },
    });
    addStep(task, {
      kind: "allowed",
      title: `Accord déjà signé par ${EMPLOYEES[owner].firstName} réutilisé`,
      detail: label,
    });
    return;
  }

  const nowMs = Date.now();
  const evaluation = evaluateExtraction({
    excerptLength: source.length,
    ownerTotalLength: ownerTotalLength(state, owner),
    distinctOwnersInTask: request.distinctOwners,
    recentRequestsToOwner: recentRequests(state, owner, nowMs),
    fullContextRequest: request.fullContextRequest,
  });
  state.requestLog.get(owner)?.push(nowMs);

  if (evaluation.outcome === "block") {
    const reason = evaluation.findings
      .filter((f) => f.outcome === "block")
      .map((f) => f.message)
      .join(" ");
    task.blocked.push({ owner, label, length: source.length, reason, kind: "rule" });
    state.audit.append({
      type: "rule.block",
      actor: task.requester,
      subject: task.id,
      data: { owner, reasons: auditReasons(evaluation.findings), excerptHash },
    });
    addStep(task, {
      kind: "rule_block",
      title: "Demande bloquée par les règles de l'enclave",
      detail: reason,
    });
    return;
  }
  if (evaluation.outcome === "warn") {
    state.audit.append({
      type: "rule.warn",
      actor: task.requester,
      subject: task.id,
      data: { owner, reasons: auditReasons(evaluation.findings), excerptHash },
    });
    addStep(task, {
      kind: "rule_warn",
      title: "Demande signalée par les règles de l'enclave",
      detail: evaluation.findings.map((f) => f.message).join(" "),
    });
  }

  const requester = EMPLOYEES[task.requester];
  const message: ContextShare = {
    recipientName: deviceName(requester),
    excerptLabel: deviceLabel(label),
    excerptLength: source.length,
    taskLabel: task.taskLabel,
    expiresAt: nowSeconds() + CONSENT_TTL_SECONDS,
    excerptHash,
    enclaveMeasurement: state.measurement,
    recipient: requester.address,
    owner: EMPLOYEES[owner].address,
    taskId: task.id,
    nonce: newNonce(),
  };
  const consent: ConsentRecord = {
    id: randomBytes32(),
    taskId: task.id,
    owner,
    requester: task.requester,
    task: task.task,
    createdAt: new Date(),
    status: "pending",
    findings: evaluation.findings,
    message,
    label,
    notes,
    excerptText: source.text,
  };
  state.consents.set(consent.id, consent);
  task.pending.push({
    consentId: consent.id,
    owner,
    label,
    length: source.length,
    findings: evaluation.findings,
  });
  state.audit.append({
    type: "consent.requested",
    actor: task.requester,
    subject: consent.id,
    data: { taskId: task.id, owner, excerptHash, length: source.length, outcome: evaluation.outcome },
  });
  addStep(task, {
    kind: "waiting_consent",
    title: `En attente de l'accord de ${EMPLOYEES[owner].firstName}, sur son Ledger`,
    detail: `${label} · ${plural(source.length, "caractère")}`,
  });
}

function runSearch(state: MockState, task: TaskRecord): void {
  const notes = state.seed.notes;
  addStep(task, {
    kind: "search",
    title: "Recherche dans la mémoire de l'enclave",
    detail: `${plural(notes.length, "note")} indexées : contexte global et contextes personnels`,
  });
  const candidates = findCandidates(task.task, notes);
  const owners = new Set(candidates.map((c) => c.note.owner));
  addStep(task, {
    kind: "candidates",
    title: plural(candidates.length, "extrait candidat", "extraits candidats"),
    detail: [...owners].map(ownerName).join(", "),
  });

  const excluded = candidates.filter((c) => isExcludedPersonalData(c.note, task.requester));
  for (const { note } of excluded) {
    task.blocked.push({
      owner: note.owner,
      label: note.label,
      length: excerptLength(note.text),
      reason: "Donnée personnelle sans rapport avec la tâche (classifieur de l'enclave).",
      kind: "classifier",
    });
  }
  if (excluded.length > 0) {
    addStep(task, {
      kind: "classified",
      title: `${plural(excluded.length, "extrait écarté", "extraits écartés")} par le classifieur`,
      detail: "Données personnelles hors sujet : elles ne quittent pas l'enclave.",
    });
  }

  const kept = candidates.filter((c) => !excluded.includes(c)).map((c) => c.note);
  const direct = kept.filter((n) => n.owner === "company" || n.owner === task.requester);
  for (const note of direct) {
    const allowedBy = note.owner === "company" ? "global" : "own";
    task.allowed.push(sourceFromNotes(`${task.id}:${note.id}`, note.owner, note.label, [note], allowedBy));
  }
  if (direct.length > 0) {
    addStep(task, {
      kind: "allowed",
      title: `${plural(direct.length, "extrait autorisé", "extraits autorisés")} d'office`,
      detail: "Contexte global de l'entreprise et votre propre contexte.",
    });
  }

  const foreign = new Map<EmployeeId, SeedNote[]>();
  for (const note of kept) {
    if (note.owner === "company" || note.owner === task.requester) continue;
    const owner = note.owner;
    const policy = activePolicyFor(state, owner, task.requester, note);
    if (policy !== undefined) {
      policy.uses += 1;
      task.allowed.push(sourceFromNotes(`${task.id}:${note.id}`, owner, note.label, [note], "policy"));
      state.audit.append({
        type: "policy.used",
        actor: task.requester,
        subject: policy.id,
        data: { taskId: task.id, owner, excerptHash: hashExcerpt(note.text) },
      });
      addStep(task, {
        kind: "policy",
        title: `Accord permanent de ${EMPLOYEES[owner].firstName} appliqué`,
        detail: `${note.label} · usage « ${policy.policy.purpose} »`,
      });
      continue;
    }
    foreign.set(owner, [...(foreign.get(owner) ?? []), note]);
  }
  for (const [owner, notes] of foreign) {
    requestForeignExcerpt(state, task, {
      owner,
      notes,
      label: bundleLabel(owner, notes),
      distinctOwners: foreign.size,
      fullContextRequest: false,
    });
  }
}

function runTrap(state: MockState, task: TaskRecord, target: EmployeeId): void {
  const notes = state.seed.notes.filter((n) => n.owner === target);
  addStep(task, {
    kind: "search",
    title: `Requête de l'agent : tout le contexte de ${EMPLOYEES[target].name}`,
    detail: "Aucune recherche liée à une tâche : l'agent demande un export complet.",
  });
  requestForeignExcerpt(state, task, {
    owner: target,
    notes,
    label: `Tout le contexte de ${EMPLOYEES[target].firstName}`,
    distinctOwners: 1,
    fullContextRequest: true,
  });
}

/** Recomputes the task status; drafts the brief inside the "enclave" once nothing is pending. */
function finalize(state: MockState, task: TaskRecord): TaskStatus {
  if (task.pending.length > 0) return "waiting_consent";
  if (task.allowed.length === 0) {
    if (!task.steps.some((s) => s.kind === "refused")) {
      addStep(task, {
        kind: "refused",
        title: "Aucun contexte autorisé : rien n'a quitté l'enclave",
        detail: "La demande a été refusée ou bloquée.",
      });
    }
    return "refused";
  }
  if (task.brief === undefined) {
    task.brief = draftBrief(task.task, task.allowed);
    const tokens = estimateTokens(task.allowed.map((s) => s.text).join(EXCERPT_SEPARATOR));
    addStep(task, {
      kind: "brief",
      title: "Brief rédigé dans l'enclave",
      detail: `${plural(task.allowed.length, "source")} · ${plural(tokens, "token")} de contexte injectés`,
    });
  }
  return "ready";
}

export function taskView(state: MockState, task: TaskRecord): TaskView {
  const status = finalize(state, task);
  const view: TaskView = {
    id: task.id,
    requester: task.requester,
    task: task.task,
    taskLabel: task.taskLabel,
    createdAt: task.createdAt.toISOString(),
    status,
    trapped: task.trapped,
    steps: task.steps,
    allowed: task.allowed.map(({ noteIds: _ids, noteTexts: _texts, text: _text, ...source }) => source),
    pending: task.pending,
    blocked: task.blocked,
  };
  if (task.brief !== undefined) view.brief = task.brief;
  if (status === "ready") {
    view.tokenStats = {
      selectedTokens: estimateTokens(task.allowed.map((s) => s.text).join(EXCERPT_SEPARATOR)),
      allContextTokens: estimateTokens(state.seed.notes.map((n) => n.text).join(EXCERPT_SEPARATOR)),
    };
  }
  return view;
}

export function createTask(state: MockState, requester: EmployeeId, input: CreateTaskInput): TaskView {
  const taskLabel = deviceLabel(input.taskLabel);
  const id = taskIdFrom(taskLabel, randomBytes32());
  const task: TaskRecord = {
    id,
    requester,
    task: input.task,
    taskLabel,
    createdAt: new Date(),
    trapped: input.trap !== undefined,
    steps: [],
    allowed: [],
    pending: [],
    blocked: [],
  };
  state.tasks.set(id, task);
  state.audit.append({
    type: "task.created",
    actor: requester,
    subject: id,
    data: { taskLabel, trapped: task.trapped },
  });
  if (input.trap !== undefined) {
    if (input.trap.requestFullContextOf === requester) {
      throw new EnclaveError("INVALID_REQUEST", "un agent piégé vise le contexte d'un autre employé");
    }
    runTrap(state, task, input.trap.requestFullContextOf);
  } else {
    runSearch(state, task);
  }
  return taskView(state, task);
}

export function getTaskRecord(state: MockState, requester: EmployeeId, taskId: Hex): TaskRecord {
  const task = state.tasks.get(taskId);
  if (task === undefined || task.requester !== requester)
    throw new EnclaveError("NOT_FOUND", "tâche inconnue");
  return task;
}

function consentRecord(state: MockState, owner: EmployeeId, consentId: string): ConsentRecord {
  const consent = state.consents.get(consentId);
  if (consent === undefined || consent.owner !== owner) {
    throw new EnclaveError("NOT_FOUND", "demande d'accord inconnue");
  }
  if (consent.status !== "pending") throw new EnclaveError("CONFLICT", `demande déjà ${consent.status}`);
  return consent;
}

function settlePending(task: TaskRecord, consentId: string) {
  const index = task.pending.findIndex((p) => p.consentId === consentId);
  const [pending] = index >= 0 ? task.pending.splice(index, 1) : [];
  return pending;
}

/** Flow 4: verify the owner's signature and the excerpt binding, store the grant, release the excerpt. */
export async function approveConsent(
  state: MockState,
  owner: EmployeeId,
  consentId: string,
  signature: Hex,
): Promise<void> {
  const consent = consentRecord(state, owner, consentId);
  await verifySignedBy({ kind: "ContextShare", message: consent.message, signature }, owner);
  checkContextShare(consent.message, {
    now: nowSeconds(),
    enclaveMeasurement: state.measurement,
    excerptText: consent.excerptText,
  });
  consumeNonce(state, consent.message.owner, consent.message.nonce);

  const grantId = hashBadgeMessage("ContextShare", consent.message);
  state.grants.set(grantId, {
    id: grantId,
    owner,
    recipient: consent.requester,
    label: consent.label,
    taskLabel: consent.message.taskLabel,
    excerptHash: consent.message.excerptHash,
    createdAt: new Date(),
    expiresAt: consent.message.expiresAt,
    uses: 1,
  });
  consent.status = "approved";
  state.audit.append({
    type: "consent.approved",
    actor: owner,
    subject: consent.id,
    data: { grantId, taskId: consent.taskId, excerptHash: consent.message.excerptHash },
  });

  const task = state.tasks.get(consent.taskId);
  if (task === undefined) return;
  settlePending(task, consentId);
  task.allowed.push(sourceFromNotes(`${task.id}:${owner}`, owner, consent.label, consent.notes, "consent"));
  addStep(task, {
    kind: "consent_received",
    title: `${EMPLOYEES[owner].firstName} a signé l'accord sur son Ledger`,
    detail: `Signature vérifiée dans l'enclave · accord ${grantId.slice(0, 10)}…`,
  });
}

export function rejectConsent(state: MockState, owner: EmployeeId, consentId: string): void {
  const consent = consentRecord(state, owner, consentId);
  consent.status = "rejected";
  state.audit.append({
    type: "consent.rejected",
    actor: owner,
    subject: consent.id,
    data: { taskId: consent.taskId, excerptHash: consent.message.excerptHash },
  });
  const task = state.tasks.get(consent.taskId);
  if (task === undefined) return;
  const pending = settlePending(task, consentId);
  task.blocked.push({
    owner,
    label: consent.label,
    length: pending?.length ?? consent.message.excerptLength,
    reason: `Refusé par ${EMPLOYEES[owner].firstName}.`,
    kind: "rejected",
  });
  addStep(task, {
    kind: "consent_rejected",
    title: `${EMPLOYEES[owner].firstName} a refusé le partage`,
    detail: consent.label,
  });
}

export function consentView(consent: ConsentRecord): ConsentRequestView {
  const expired = consent.status === "pending" && consent.message.expiresAt <= nowSeconds();
  return {
    id: consent.id,
    taskId: consent.taskId,
    owner: consent.owner,
    requester: consent.requester,
    taskLabel: consent.message.taskLabel,
    createdAt: consent.createdAt.toISOString(),
    status: expired ? "expired" : consent.status,
    findings: consent.findings,
    message: encodeBadgeMessage("ContextShare", consent.message),
    excerpt: { text: consent.excerptText, tags: [...new Set(consent.notes.flatMap((n) => n.tags))] },
  };
}
