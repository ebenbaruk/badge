/**
 * Mock of enrollment, agent sessions, standing agreements and revocations (contract flows 1, 2, 6 and 7).
 * Every signed message is verified exactly as the enclave does: signature by the directory address, intrinsic
 * checks of @badge/consent, then nonce replay protection.
 */
import {
  checkAgentSession,
  checkContextPolicy,
  checkContextRevoke,
  checkEmployeeEnroll,
  hashBadgeMessage,
  type SignedMessage,
} from "@badge/consent";
import { isAddressEqual, zeroAddress } from "viem";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { EnclaveError } from "../errors";
import { AGENT_SESSION_TTL_SECONDS, deviceName } from "../messages";
import type { EnrollmentView, GrantView, PolicyView } from "../enclave/types";
import {
  consumeNonce,
  employeeByAddress,
  nowSeconds,
  secondsToIso,
  verifySignedBy,
  type MockState,
  type PolicyRecord,
} from "./state";

export function enrollmentView(state: MockState, employee: EmployeeId): EnrollmentView {
  const enrolledAt = state.enrollments.get(employee);
  if (enrolledAt === undefined) return { enrolled: false };
  const view: EnrollmentView = { enrolled: true, enrolledAt: enrolledAt.toISOString() };
  const session = state.sessions.get(employee);
  if (session !== undefined && session.expiresAt > nowSeconds()) {
    view.session = {
      sessionKey: session.sessionKey,
      agentName: session.agentName,
      expiresAt: secondsToIso(session.expiresAt),
    };
  }
  return view;
}

export async function enroll(
  state: MockState,
  signed: SignedMessage<"EmployeeEnroll">,
): Promise<EnrollmentView> {
  const employee = employeeByAddress(signed.message.employee);
  await verifySignedBy(signed, employee);
  checkEmployeeEnroll(signed.message, { now: nowSeconds(), enclaveMeasurement: state.measurement });
  consumeNonce(state, signed.message.employee, signed.message.nonce);
  state.enrollments.set(employee, new Date());
  state.audit.append({
    type: "enroll",
    actor: employee,
    subject: signed.message.employee,
    data: { team: signed.message.team },
  });
  return enrollmentView(state, employee);
}

export async function openSession(
  state: MockState,
  employee: EmployeeId,
  signed: SignedMessage<"AgentSession">,
): Promise<EnrollmentView> {
  if (!state.enrollments.has(employee)) {
    throw new EnclaveError("NOT_ENROLLED", `${EMPLOYEES[employee].name} n'a pas encore rejoint Badge`);
  }
  if (!isAddressEqual(signed.message.employee, EMPLOYEES[employee].address)) {
    throw new EnclaveError("FORBIDDEN", "session signée pour un autre employé");
  }
  await verifySignedBy(signed, employee);
  const now = nowSeconds();
  checkAgentSession(signed.message, { now, enclaveMeasurement: state.measurement });
  if (signed.message.expiresAt - now > AGENT_SESSION_TTL_SECONDS) {
    throw new EnclaveError("INVALID_REQUEST", "une session d'agent dure au plus 12 h");
  }
  consumeNonce(state, signed.message.employee, signed.message.nonce);
  state.sessions.set(employee, {
    sessionKey: signed.message.sessionKey,
    agentName: signed.message.agentName,
    expiresAt: signed.message.expiresAt,
  });
  state.audit.append({
    type: "session.open",
    actor: employee,
    subject: signed.message.sessionKey,
    data: { expiresAt: secondsToIso(signed.message.expiresAt) },
  });
  return enrollmentView(state, employee);
}

function policyView(record: PolicyRecord): PolicyView {
  const view: PolicyView = {
    id: record.id,
    owner: record.owner,
    granteeTeam: record.policy.granteeTeam,
    contextTag: record.policy.contextTag,
    purpose: record.policy.purpose,
    maxExcerptLength: record.policy.maxExcerptLength,
    createdAt: record.createdAt.toISOString(),
    expiresAt: secondsToIso(record.policy.expiresAt),
    uses: record.uses,
  };
  if (record.revokedAt !== undefined) view.revokedAt = record.revokedAt.toISOString();
  return view;
}

export async function createPolicy(
  state: MockState,
  owner: EmployeeId,
  signed: SignedMessage<"ContextPolicy">,
): Promise<PolicyView> {
  if (!isAddressEqual(signed.message.owner, EMPLOYEES[owner].address)) {
    throw new EnclaveError("FORBIDDEN", "accord signé pour un autre propriétaire");
  }
  await verifySignedBy(signed, owner);
  checkContextPolicy(signed.message, { now: nowSeconds(), enclaveMeasurement: state.measurement });
  consumeNonce(state, signed.message.owner, signed.message.nonce);
  const id = hashBadgeMessage("ContextPolicy", signed.message);
  const record: PolicyRecord = { id, owner, policy: signed.message, createdAt: new Date(), uses: 0 };
  state.policies.set(id, record);
  state.audit.append({
    type: "policy.created",
    actor: owner,
    subject: id,
    data: {
      granteeTeam: signed.message.granteeTeam,
      contextTag: signed.message.contextTag,
      maxExcerptLength: signed.message.maxExcerptLength,
      expiresAt: secondsToIso(signed.message.expiresAt),
    },
  });
  return policyView(record);
}

export function listPolicies(state: MockState, owner: EmployeeId): PolicyView[] {
  return [...state.policies.values()]
    .filter((p) => p.owner === owner)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(policyView);
}

export function listGrants(state: MockState, owner: EmployeeId): GrantView[] {
  const shares: GrantView[] = [...state.grants.values()]
    .filter((g) => g.owner === owner)
    .map((g) => {
      const view: GrantView = {
        id: g.id,
        kind: "share",
        owner,
        recipient: g.recipient,
        recipientLabel: deviceName(EMPLOYEES[g.recipient]),
        label: `${g.label} · ${g.taskLabel}`,
        createdAt: g.createdAt.toISOString(),
        expiresAt: secondsToIso(g.expiresAt),
        uses: g.uses,
      };
      if (g.revokedAt !== undefined) view.revokedAt = g.revokedAt.toISOString();
      return view;
    });
  const policies: GrantView[] = listPolicies(state, owner).map((p) => {
    const view: GrantView = {
      id: p.id,
      kind: "policy",
      owner,
      recipientLabel: `Équipe ${p.granteeTeam}`,
      label: `${p.contextTag} · ${p.purpose}`,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      uses: p.uses,
    };
    if (p.revokedAt !== undefined) view.revokedAt = p.revokedAt;
    return view;
  });
  return [...shares, ...policies].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Flow 6: revokes one grant or policy (by id) or, with grantId = 0x0, every share to `recipient`. The real enclave
 * also rotates the owner's data key; the audit entry records it.
 */
export async function revoke(
  state: MockState,
  owner: EmployeeId,
  signed: SignedMessage<"ContextRevoke">,
): Promise<{ revoked: number }> {
  const message = signed.message;
  if (!isAddressEqual(message.owner, EMPLOYEES[owner].address)) {
    throw new EnclaveError("FORBIDDEN", "révocation signée pour un autre propriétaire");
  }
  await verifySignedBy(signed, owner);
  checkContextRevoke(message, { now: nowSeconds() });
  consumeNonce(state, message.owner, message.nonce);

  const now = new Date();
  let revoked = 0;
  const revokeAll = /^0x0{64}$/i.test(message.grantId);
  for (const grant of state.grants.values()) {
    if (grant.owner !== owner || grant.revokedAt !== undefined) continue;
    const matches = revokeAll
      ? !isAddressEqual(message.recipient, zeroAddress) &&
        isAddressEqual(EMPLOYEES[grant.recipient].address, message.recipient)
      : grant.id === message.grantId;
    if (matches) {
      grant.revokedAt = now;
      revoked += 1;
    }
  }
  const policy = state.policies.get(message.grantId);
  if (!revokeAll && policy !== undefined && policy.owner === owner && policy.revokedAt === undefined) {
    policy.revokedAt = now;
    revoked += 1;
  }
  if (revoked === 0) throw new EnclaveError("NOT_FOUND", "aucun accord actif ne correspond");
  state.audit.append({
    type: "revoke",
    actor: owner,
    subject: message.grantId,
    data: { recipient: message.recipient, revoked, dekRotated: true },
  });
  return { revoked };
}

export function contextTags(state: MockState, owner: EmployeeId): string[] {
  const tags = new Set<string>();
  for (const note of state.seed.notes) {
    if (note.owner !== owner) continue;
    // Desk tags route anonymous desk exchanges; they are not offered for standing agreements.
    for (const tag of note.tags) if (!tag.startsWith("desk:")) tags.add(tag);
  }
  return [...tags].sort();
}
