/**
 * In-memory enclave for the demo (BADGE_ENCLAVE_MODE=mock). It enforces the same rules as the contract
 * (signatures, intrinsic checks, nonces, rules, ZK proofs) on scripted data from infra/seed/acme.json, so every
 * device signature and proof made through the UI is real even though the enclave is not.
 */
import type { ContextRevoke, SignedMessage } from "@badge/consent";
import type { DeskProofWire } from "@badge/zk";
import { complianceKeyRegistrationMessage } from "@badge/attest";
import { isAddressEqual, keccak256, recoverMessageAddress, toHex, type Hex } from "viem";
import { COMPANY_NAME, EMPLOYEES, type DeskId, type EmployeeId } from "@/lib/directory";
import { EnclaveError } from "../errors";
import { consentHistoryEntry } from "../enclave/history";
import type {
  AttestationView,
  RevocationTargetView,
  ComplianceKeyInput,
  RevealNoticeInput,
  AuditView,
  ConsentHistoryView,
  ConsentRequestView,
  CreateTaskInput,
  DeskRequestView,
  DeskRequestsView,
  DeskView,
  EnclaveApi,
  EnrollmentView,
  GrantView,
  PolicyView,
  SealedIdentityView,
  TaskView,
} from "../enclave/types";
import * as access from "./access";
import { verifyChain } from "./audit";
import * as desks from "./desks";
import { createMockState, mockMeasurement, type MockState } from "./state";
import * as tasks from "./tasks";

const ALERT_TYPES: ReadonlySet<string> = new Set(["rule.warn", "rule.block"]);
const APP_ID_BYTES = 20;

export class MockEnclave implements EnclaveApi {
  readonly mode = "mock" as const;
  private readonly state: MockState;
  private readonly startedAt = new Date();

  constructor(measurementOverride?: Hex) {
    this.state = createMockState(mockMeasurement(measurementOverride), desks.initialDeskCommitments());
  }

  async attestation(): Promise<AttestationView> {
    return {
      mode: "simulated",
      verified: true,
      measurement: this.state.measurement,
      keyProvider: "mock",
      tcbStatus: "Simulated",
      appId: keccak256(toHex("badge/mock-app")).slice(0, 2 + APP_ID_BYTES * 2),
      warnings: [
        "Enclave simulée (mode démo) : aucune garantie matérielle.",
        "Les signatures Ledger et les preuves ZK sont réelles et vérifiées.",
      ],
      checkedAt: this.startedAt.toISOString(),
    };
  }

  async enrollment(employee: EmployeeId): Promise<EnrollmentView> {
    const view = access.enrollmentView(this.state, employee);
    const key = this.state.complianceKey;
    if (EMPLOYEES[employee].role === "compliance" && key !== undefined) {
      view.complianceKey = { publicKey: key.publicKey, registeredAt: key.registeredAt.toISOString() };
    }
    return view;
  }

  async enroll(signed: SignedMessage<"EmployeeEnroll">): Promise<EnrollmentView> {
    return access.enroll(this.state, signed);
  }

  async openSession(employee: EmployeeId, signed: SignedMessage<"AgentSession">): Promise<EnrollmentView> {
    return access.openSession(this.state, employee, signed);
  }

  async createTask(requester: EmployeeId, input: CreateTaskInput): Promise<TaskView> {
    return tasks.createTask(this.state, requester, input);
  }

  async getTask(requester: EmployeeId, taskId: Hex): Promise<TaskView> {
    return tasks.taskView(this.state, tasks.getTaskRecord(this.state, requester, taskId));
  }

  async listTasks(requester: EmployeeId): Promise<TaskView[]> {
    return [...this.state.tasks.values()]
      .filter((t) => t.requester === requester)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((t) => tasks.taskView(this.state, t));
  }

  async listConsents(owner: EmployeeId): Promise<ConsentRequestView[]> {
    return this.consentsOf(owner).filter((c) => c.status === "pending");
  }

  async consentHistory(owner: EmployeeId): Promise<ConsentHistoryView[]> {
    return this.consentsOf(owner).flatMap((c) =>
      c.status === "pending" ? [] : [consentHistoryEntry(c, c.status)],
    );
  }

  private consentsOf(owner: EmployeeId): ConsentRequestView[] {
    return [...this.state.consents.values()]
      .filter((c) => c.owner === owner)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(tasks.consentView);
  }

  async approveConsent(owner: EmployeeId, consentId: string, signature: Hex): Promise<void> {
    await tasks.approveConsent(this.state, owner, consentId, signature);
  }

  async rejectConsent(owner: EmployeeId, consentId: string): Promise<void> {
    tasks.rejectConsent(this.state, owner, consentId);
  }

  async listGrants(owner: EmployeeId): Promise<GrantView[]> {
    return access.listGrants(this.state, owner);
  }

  async prepareRevocation(owner: EmployeeId, target: RevocationTargetView): Promise<ContextRevoke> {
    return access.prepareRevocation(this.state, owner, target);
  }

  async revoke(owner: EmployeeId, signed: SignedMessage<"ContextRevoke">): Promise<{ revoked: number }> {
    return access.revoke(this.state, owner, signed);
  }

  async createPolicy(owner: EmployeeId, signed: SignedMessage<"ContextPolicy">): Promise<PolicyView> {
    return access.createPolicy(this.state, owner, signed);
  }

  async listPolicies(owner: EmployeeId): Promise<PolicyView[]> {
    return access.listPolicies(this.state, owner);
  }

  async contextTags(owner: EmployeeId): Promise<string[]> {
    return access.contextTags(this.state, owner);
  }

  async listDesks(viewer: EmployeeId): Promise<DeskView[]> {
    return desks.listDesks(this.state, viewer);
  }

  async joinDesk(employee: EmployeeId, signed: SignedMessage<"DeskJoin">): Promise<DeskView> {
    return desks.joinDesk(this.state, employee, signed);
  }

  async createDeskRequest(
    requester: EmployeeId,
    input: { fromDesk: DeskId; toDesk: DeskId; task: string },
  ): Promise<DeskRequestView> {
    return desks.createDeskRequest(this.state, requester, input);
  }

  async listDeskRequests(viewer: EmployeeId): Promise<DeskRequestsView> {
    return desks.listDeskRequests(this.state, viewer);
  }

  async approveDeskRequest(
    owner: EmployeeId,
    requestId: Hex,
    signed: SignedMessage<"DeskShare">,
    proof: DeskProofWire,
  ): Promise<void> {
    await desks.approveDeskRequest(this.state, owner, requestId, signed, proof);
  }

  async rejectDeskRequest(owner: EmployeeId, requestId: Hex): Promise<void> {
    desks.rejectDeskRequest(this.state, owner, requestId);
  }

  async registerComplianceKey(viewer: EmployeeId, input: ComplianceKeyInput): Promise<EnrollmentView> {
    this.assertCompliance(viewer);
    const recovered = await recoverMessageAddress({
      message: complianceKeyRegistrationMessage(COMPANY_NAME, input.publicKey),
      signature: input.signature,
    });
    if (!isAddressEqual(recovered, EMPLOYEES[viewer].address)) {
      throw new EnclaveError("SIGNATURE_REJECTED", "clé de conformité signée par un autre appareil");
    }
    this.state.complianceKey = { publicKey: input.publicKey, registeredAt: new Date() };
    this.state.audit.append({
      type: "compliance.key",
      actor: viewer,
      subject: viewer,
      data: { publicKey: input.publicKey },
    });
    return this.enrollment(viewer);
  }

  async audit(viewer: EmployeeId): Promise<AuditView> {
    this.assertCompliance(viewer);
    const entries = [...this.state.audit.entries()];
    return {
      entries,
      chain: verifyChain(entries),
      alerts: entries.filter((e) => ALERT_TYPES.has(e.type)),
      sealed: [...this.state.sealed.values()].map(desks.sealedView),
    };
  }

  async revealNotice(viewer: EmployeeId, input: RevealNoticeInput): Promise<SealedIdentityView> {
    this.assertCompliance(viewer);
    const record = this.state.sealed.get(input.seq);
    if (record === undefined)
      throw new EnclaveError("NOT_FOUND", `aucune identité scellée à l'entrée ${input.seq}`);
    record.revealedAt ??= new Date();
    this.state.audit.append({
      type: "compliance.reveal",
      actor: viewer,
      subject: String(input.seq),
      data: { auditSeq: input.seq, reason: input.reason },
    });
    return desks.sealedView(record);
  }

  private assertCompliance(viewer: EmployeeId): void {
    if (EMPLOYEES[viewer].role !== "compliance") {
      throw new EnclaveError("FORBIDDEN", "réservé au rôle conformité");
    }
  }
}
