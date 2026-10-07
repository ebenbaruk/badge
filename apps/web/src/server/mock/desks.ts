/**
 * Mock of the anonymous desk exchange (contract flow 8): Semaphore groups per desk, exchange rules, DeskShare
 * consents approved with a REAL Ledger signature and a REAL Groth16 membership proof, verified here exactly as the
 * enclave does (root of the source desk, excerpt hash as message, request id as scope, nullifier unused).
 */
import {
  checkDeskJoin,
  checkDeskShare,
  encodeBadgeMessage,
  excerptLength,
  hashBadgeMessage,
  hashExcerpt,
  toDeviceAscii,
  type DeskShare,
  type SignedMessage,
} from "@badge/consent";
import {
  decodeDeskProof,
  deriveDeskIdentity,
  deskGroupRoot,
  verifyDeskProof,
  type DeskProofWire,
} from "@badge/zk";
import { concatHex, isAddressEqual, keccak256, toHex, type Hex } from "viem";
import { DESK_IDS, DESK_NAMES, EMPLOYEES, type DeskId, type EmployeeId } from "@/lib/directory";
import { EnclaveError } from "../errors";
import { deviceLabel, newNonce } from "../messages";
import type {
  DeskConsentView,
  DeskRequestView,
  DeskRequestsView,
  DeskView,
  SealedIdentityView,
} from "../enclave/types";
import { findCandidates } from "./retrieval";
import { CONSENT_TTL_SECONDS } from "./tasks";
import {
  consumeNonce,
  nowSeconds,
  randomBytes32,
  verifySignedBy,
  type DeskRequestRecord,
  type MockState,
  type SealedRecord,
} from "./state";

/**
 * Research has two extra directory-only members (no demo Ledger) whose identities the seed pre-registers, so the
 * anonymity set is 3 once Bob joins: Semaphore warns that groups of 1 or 2 are not anonymous.
 */
const PREREGISTERED_MEMBERS: Readonly<Record<DeskId, readonly string[]>> = {
  research: ["david", "emma"],
  origination: [],
};

/** Desk exchange rules ("Chinese walls"): which desk may receive what from which desk. */
export const EXCHANGE_RULES = [
  {
    id: "R-01",
    sourceDesk: "research",
    recipientDesk: "origination",
    allowedTopics: ["marche-capteurs", "prix-composants"],
    label: "Research vers Origination : marche",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  sourceDesk: DeskId;
  recipientDesk: DeskId;
  allowedTopics: readonly string[];
  label: string;
}>;

/** Deterministic stand-in for a member's Ledger signature, so pre-registered identities are stable across runs. */
function preregisteredCommitment(name: string): bigint {
  const seed = keccak256(toHex(`badge/demo-member/${name}`));
  const fakeSignature = concatHex([seed, keccak256(seed), "0x1b"]);
  return deriveDeskIdentity(fakeSignature).commitment;
}

export function initialDeskCommitments(): Map<DeskId, bigint[]> {
  return new Map(DESK_IDS.map((desk) => [desk, PREREGISTERED_MEMBERS[desk].map(preregisteredCommitment)]));
}

function deskByName(name: string): DeskId {
  const desk = DESK_IDS.find((id) => toDeviceAscii(DESK_NAMES[id]) === name);
  if (desk === undefined) throw new EnclaveError("NOT_FOUND", `desk inconnu : ${name}`);
  return desk;
}

function directoryMembers(state: MockState, desk: DeskId): EmployeeId[] {
  return state.seed.desks.find((d) => d.id === desk)?.directoryMembers ?? [];
}

function deskView(state: MockState, desk: DeskId, viewer: EmployeeId): DeskView {
  const commitments = state.deskCommitments.get(desk) ?? [];
  return {
    id: desk,
    name: DESK_NAMES[desk],
    directoryMembers: directoryMembers(state, desk).length + PREREGISTERED_MEMBERS[desk].length,
    commitments: commitments.map(String),
    root: commitments.length > 0 ? String(deskGroupRoot(commitments)) : null,
    isMember: EMPLOYEES[viewer].desks.includes(desk),
    joined: state.deskJoined.get(viewer)?.has(desk) ?? false,
    allowedTopics: state.seed.desks.find((d) => d.id === desk)?.allowedTopics ?? [],
    requestable: EXCHANGE_RULES.some(
      (rule) => rule.sourceDesk === desk && EMPLOYEES[viewer].desks.includes(rule.recipientDesk),
    ),
  };
}

export function listDesks(state: MockState, viewer: EmployeeId): DeskView[] {
  return DESK_IDS.map((desk) => deskView(state, desk, viewer));
}

export async function joinDesk(
  state: MockState,
  employee: EmployeeId,
  signed: SignedMessage<"DeskJoin">,
): Promise<DeskView> {
  const message = signed.message;
  if (!isAddressEqual(message.employee, EMPLOYEES[employee].address)) {
    throw new EnclaveError("FORBIDDEN", "adhésion signée pour un autre employé");
  }
  await verifySignedBy(signed, employee);
  checkDeskJoin(message);
  const desk = deskByName(message.deskName);
  if (!directoryMembers(state, desk).includes(employee)) {
    throw new EnclaveError(
      "FORBIDDEN",
      `${EMPLOYEES[employee].name} n'est pas membre du desk ${DESK_NAMES[desk]}`,
    );
  }
  const commitments = state.deskCommitments.get(desk) ?? [];
  if (commitments.includes(message.identityCommitment)) {
    throw new EnclaveError("CONFLICT", "identité déjà enregistrée dans ce desk");
  }
  consumeNonce(state, message.employee, message.nonce);
  commitments.push(message.identityCommitment);
  state.deskCommitments.set(desk, commitments);
  state.deskJoined.set(employee, new Set([...(state.deskJoined.get(employee) ?? []), desk]));
  const root = String(deskGroupRoot(commitments));
  state.audit.append({
    type: "desk.join",
    actor: employee,
    subject: desk,
    data: { members: commitments.length, root },
  });
  return deskView(state, desk, employee);
}

function requestView(record: DeskRequestRecord): DeskRequestView {
  const view: DeskRequestView = {
    id: record.id,
    fromDesk: record.fromDesk,
    toDesk: record.toDesk,
    task: record.task,
    ruleLabel: record.ruleLabel,
    createdAt: record.createdAt.toISOString(),
    status: record.status,
  };
  if (record.delivery !== undefined) {
    view.delivery = {
      excerpt: record.note.text,
      label: record.note.label,
      sourceDesk: record.toDesk,
      nullifier: record.delivery.nullifier,
      root: record.delivery.root,
      deliveredAt: record.delivery.deliveredAt.toISOString(),
    };
  }
  return view;
}

function consentView(record: DeskRequestRecord): DeskConsentView {
  return {
    id: record.id,
    owner: record.owner,
    fromDesk: record.fromDesk,
    task: record.task,
    createdAt: record.createdAt.toISOString(),
    status: record.status === "delivered" ? "approved" : record.status,
    message: encodeBadgeMessage("DeskShare", record.message),
  };
}

export function createDeskRequest(
  state: MockState,
  requester: EmployeeId,
  input: { fromDesk: DeskId; toDesk: DeskId; task: string },
): DeskRequestView {
  if (!EMPLOYEES[requester].desks.includes(input.fromDesk)) {
    throw new EnclaveError("FORBIDDEN", `vous n'êtes pas membre du desk ${DESK_NAMES[input.fromDesk]}`);
  }
  const rule = EXCHANGE_RULES.find(
    (r) => r.sourceDesk === input.toDesk && r.recipientDesk === input.fromDesk,
  );
  if (rule === undefined) {
    throw new EnclaveError("FORBIDDEN", "aucune règle d'échange n'autorise ce flux entre desks");
  }
  const sourceMembers = directoryMembers(state, input.toDesk).filter((m) => m !== requester);
  const topics = new Set<string>(rule.allowedTopics);
  const eligible = state.seed.notes.filter(
    (note) =>
      note.owner !== "company" &&
      sourceMembers.includes(note.owner) &&
      note.tags.includes(`desk:${input.toDesk}`) &&
      note.tags.some((tag) => topics.has(tag)),
  );
  const [best] = findCandidates(input.task, eligible);
  if (best === undefined || best.note.owner === "company") {
    throw new EnclaveError("NOT_FOUND", "aucun extrait du desk ne correspond à cette demande et à la règle");
  }
  const note = best.note;
  const id = randomBytes32();
  const message: DeskShare = {
    recipientDesk: toDeviceAscii(DESK_NAMES[input.fromDesk]),
    excerptLabel: deviceLabel(note.label),
    excerptLength: excerptLength(note.text),
    ruleLabel: deviceLabel(rule.label),
    expiresAt: nowSeconds() + CONSENT_TTL_SECONDS,
    excerptHash: hashExcerpt(note.text),
    enclaveMeasurement: state.measurement,
    sourceDesk: toDeviceAscii(DESK_NAMES[input.toDesk]),
    requestId: id,
    nonce: newNonce(),
  };
  const record: DeskRequestRecord = {
    id,
    requester,
    owner: note.owner as EmployeeId,
    fromDesk: input.fromDesk,
    toDesk: input.toDesk,
    task: input.task,
    ruleLabel: rule.label,
    createdAt: new Date(),
    status: "pending",
    note,
    message,
  };
  state.deskRequests.set(id, record);
  state.audit.append({
    type: "consent.requested",
    actor: requester,
    subject: id,
    data: { kind: "desk", rule: rule.id, fromDesk: input.fromDesk, toDesk: input.toDesk },
  });
  return requestView(record);
}

export function listDeskRequests(state: MockState, viewer: EmployeeId): DeskRequestsView {
  const records = [...state.deskRequests.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return {
    incoming: records.filter((r) => r.owner === viewer).map(consentView),
    outgoing: records.filter((r) => r.requester === viewer).map(requestView),
  };
}

function pendingRequest(state: MockState, owner: EmployeeId, requestId: Hex): DeskRequestRecord {
  const record = state.deskRequests.get(requestId);
  if (record === undefined || record.owner !== owner) throw new EnclaveError("NOT_FOUND", "demande inconnue");
  if (record.status !== "pending") throw new EnclaveError("CONFLICT", `demande déjà ${record.status}`);
  return record;
}

/**
 * Mock sealing of the sharer's identity: an opaque token only. The real enclave encrypts the signer to the
 * compliance officer's X25519 key; the de-anonymisation then happens client-side with a key from her Ledger.
 */
function sealIdentity(employee: EmployeeId, requestId: Hex): string {
  return keccak256(toHex(`sealed/${employee}/${requestId}`));
}

export async function approveDeskRequest(
  state: MockState,
  owner: EmployeeId,
  requestId: Hex,
  signed: SignedMessage<"DeskShare">,
  proofWire: DeskProofWire,
): Promise<void> {
  const record = pendingRequest(state, owner, requestId);
  // The owner must sign exactly the message the enclave prepared, not a variant of it.
  if (hashBadgeMessage("DeskShare", signed.message) !== hashBadgeMessage("DeskShare", record.message)) {
    throw new EnclaveError("SIGNATURE_REJECTED", "le message signé diffère de celui préparé par l'enclave");
  }
  if (!(state.deskJoined.get(owner)?.has(record.toDesk) ?? false)) {
    throw new EnclaveError("FORBIDDEN", `rejoignez d'abord le desk ${DESK_NAMES[record.toDesk]}`);
  }
  await verifySignedBy(signed, owner);
  checkDeskShare(record.message, {
    now: nowSeconds(),
    enclaveMeasurement: state.measurement,
    excerptText: record.note.text,
  });
  const commitments = state.deskCommitments.get(record.toDesk) ?? [];
  const root = deskGroupRoot(commitments);
  const { nullifier } = await verifyDeskProof(
    decodeDeskProof(proofWire),
    { expectedRoot: root, expectedExcerptHash: record.message.excerptHash, expectedRequestId: record.id },
    state.nullifiers,
  );
  consumeNonce(state, EMPLOYEES[owner].address, record.message.nonce);

  record.status = "delivered";
  record.delivery = { nullifier: String(nullifier), root: String(root), deliveredAt: new Date() };
  const sealed = sealIdentity(owner, record.id);
  // Actor is the desk, never the person: the audit trail itself must not de-anonymise the sharer.
  const entry = state.audit.append({
    type: "desk.share",
    actor: `desk:${record.toDesk}`,
    subject: record.id,
    data: {
      sourceDesk: record.toDesk,
      recipientDesk: record.fromDesk,
      excerptHash: record.message.excerptHash,
      nullifier: String(nullifier),
      sealedSigner: sealed,
    },
  });
  state.sealed.set(entry.seq, {
    seq: entry.seq,
    ts: new Date(entry.ts),
    sourceDesk: record.toDesk,
    label: record.note.label,
    sealed,
    signer: owner,
  });
}

export function rejectDeskRequest(state: MockState, owner: EmployeeId, requestId: Hex): void {
  const record = pendingRequest(state, owner, requestId);
  record.status = "rejected";
  state.audit.append({
    type: "consent.rejected",
    actor: `desk:${record.toDesk}`,
    subject: record.id,
    data: { kind: "desk" },
  });
}

export function sealedView(record: SealedRecord): SealedIdentityView {
  const view: SealedIdentityView = {
    seq: record.seq,
    ts: record.ts.toISOString(),
    sourceDesk: record.sourceDesk,
    label: record.label,
    sealed: record.sealed,
  };
  if (record.revealedAt !== undefined) {
    view.revealed = { employee: record.signer, revealedAt: record.revealedAt.toISOString() };
  }
  return view;
}
