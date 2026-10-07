/**
 * The real enclave, through @badge/client over the attested channel. This server is each employee's agent runtime
 * and device bridge: it holds one agent session key per employee (delegated on their Ledger) and the agent's own
 * memory of what it asked (task and desk request ids), because the enclave answers per id, not per list. Both are
 * persisted owner-only (agent-store.ts), so a restart of this server does not cost a new Ledger signature.
 *
 * Attestation: the quote is verified before any key is derived (`simulated` locally against the dstack simulator,
 * `tdx` in production with the compose hash pinned). Every message the Ledgers sign is pinned to the measurement of
 * the enclave that was just verified.
 */
import { BadgeApiError, BadgeClient, type Session } from "@badge/client";
import type { SignedMessage } from "@badge/consent";
import {
  decodeDeskProof,
  InMemoryNullifierRegistry,
  verifyDeskProof,
  ZkError,
  type DeskProofWire,
} from "@badge/zk";
import { isAddressEqual, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EMPLOYEE_IDS, EMPLOYEES, type DeskId, type EmployeeId } from "@/lib/directory";
import type { LiveEnclaveConfig } from "../config";
import { DESK_DIRECTORY, EXCHANGE_RULES } from "../desk-directory";
import { AgentStore, type PersistedRuntime } from "../agent-store";
import { AgentSessionMissingError, EnclaveError } from "../errors";
import { agentSessionKey, cachedDeskIdentity } from "../keys";
import {
  attestationView,
  auditView,
  consentView,
  deskConsentView,
  deskIdOf,
  employeeIdOf,
  grantViews,
  isoFromSeconds,
  policyView,
  taskView,
  type TaskRecord,
} from "./live-views";
import type {
  AttestationView,
  AuditView,
  ComplianceKeyInput,
  ConsentRequestView,
  CreateTaskInput,
  DeskRequestView,
  DeskRequestsView,
  DeskView,
  EnclaveApi,
  EnrollmentView,
  GrantView,
  PolicyView,
  RevealNoticeInput,
  SealedIdentityView,
  TaskView,
} from "./types";

/** Tasks shown in the agent thread (newest first); older ones stay in the enclave and the audit log. */
const MAX_TASKS_SHOWN = 8;
/** The enclave caps audit pages at 500 entries. */
const AUDIT_PAGE_SIZE = 500;
/** Decided consents kept for the inbox history (this bridge's own decisions). */
const MAX_CONSENT_HISTORY = 20;
const MS_PER_SECOND = 1000;

interface DeskRequestRecord {
  id: Hex;
  task: string;
}

/**
 * Everything the agent runtime holds for one employee. Enrollment, agent session and the task / desk request ids are
 * persisted; the rest is a cache of this process (consent history, revealed identities, proof checks).
 */
interface EmployeeRuntime {
  enrolledAt?: Date;
  agent?: { client: BadgeClient; session: Session; privateKey: Hex };
  tasks: TaskRecord[];
  deskRequests: DeskRequestRecord[];
  consentHistory: ConsentRequestView[];
  complianceKey?: { publicKey: string; registeredAt: Date };
  /** Desk shares this officer de-anonymised (seq -> signer), decrypted on her side and never sent anywhere. */
  revealed: Map<number, EmployeeId>;
  /** Proof checks of anonymous deliveries, done once (the source desk root may change later). */
  verifiedDeliveries: Map<Hex, boolean>;
}

const newRuntime = (): EmployeeRuntime => ({
  tasks: [],
  deskRequests: [],
  consentHistory: [],
  revealed: new Map(),
  verifiedDeliveries: new Map(),
});

// The agent runtime's memory lives on globalThis so that dev hot reloads swap the code without reloading it from
// disk (and without two copies diverging). Production runs a single module instance.
const RUNTIMES_KEY = Symbol.for("badge.web.live-runtimes");
const globalRuntimes = globalThis as typeof globalThis & {
  [RUNTIMES_KEY]?: Map<EmployeeId, EmployeeRuntime>;
};

export class LiveEnclave implements EnclaveApi {
  readonly mode = "live" as const;
  /** Channel without a session key: attestation, enrollment and session opening (Ledger-signed bodies). */
  private readonly bootstrap: BadgeClient;
  private readonly store: AgentStore;
  private readonly runtimes: Map<EmployeeId, EmployeeRuntime>;
  private attested: Promise<AttestationView> | undefined;

  constructor(private readonly config: LiveEnclaveConfig) {
    this.bootstrap = this.newClient();
    this.store = new AgentStore(config.dataDir);
    this.runtimes = globalRuntimes[RUNTIMES_KEY] ??= this.restore(this.store.load());
  }

  // ---- Attestation, enrollment, sessions ----

  attestation(): Promise<AttestationView> {
    // Verified once per bridge process (the channel transport re-verifies whenever it reopens a channel). A failure
    // is not cached, so the badge recovers once the enclave is back.
    this.attested ??= this.bootstrap.connect().then(
      (result) => attestationView(result, new Date()),
      (error: unknown) => {
        this.attested = undefined;
        throw error;
      },
    );
    return this.attested;
  }

  async enrollment(employee: EmployeeId): Promise<EnrollmentView> {
    const runtime = this.runtime(employee);
    if (this.activeAgent(employee) !== undefined) {
      try {
        await this.syncComplianceKey(employee, runtime);
      } catch (error) {
        // The enclave forgot the session (reset, revoked): the view below then asks for a new delegation.
        if (!(error instanceof AgentSessionMissingError)) throw error;
      }
    }
    const agent = this.activeAgent(employee);
    const view: EnrollmentView = { enrolled: runtime.enrolledAt !== undefined || agent !== undefined };
    if (runtime.enrolledAt !== undefined) view.enrolledAt = runtime.enrolledAt.toISOString();
    if (agent !== undefined) {
      view.session = {
        sessionKey: agent.session.sessionKey,
        agentName: agent.session.agentName,
        expiresAt: isoFromSeconds(agent.session.expiresAt),
      };
    }
    if (runtime.complianceKey !== undefined) {
      view.complianceKey = {
        publicKey: runtime.complianceKey.publicKey,
        registeredAt: runtime.complianceKey.registeredAt.toISOString(),
      };
    }
    return view;
  }

  async enroll(signed: SignedMessage<"EmployeeEnroll">): Promise<EnrollmentView> {
    const { employee } = await this.bootstrap.enroll(signed);
    const id = employeeIdOf(employee.id);
    this.runtime(id).enrolledAt = new Date();
    this.persist();
    return this.enrollment(id);
  }

  async openSession(employee: EmployeeId, signed: SignedMessage<"AgentSession">): Promise<EnrollmentView> {
    const key = agentSessionKey(employee);
    // The bridge only registers the key it holds: a session for any other key would be unusable here.
    if (key === undefined || !isAddressEqual(key.account.address, signed.message.sessionKey)) {
      throw new EnclaveError("INVALID_REQUEST", "the signed session key is not this agent's key");
    }
    const session = await this.bootstrap.openSession(signed);
    const runtime = this.runtime(employee);
    runtime.agent = { client: this.newClient(key.account), session, privateKey: key.privateKey };
    runtime.enrolledAt ??= new Date();
    this.persist();
    return this.enrollment(employee);
  }

  // ---- Tasks and consents ----

  async createTask(requester: EmployeeId, input: CreateTaskInput): Promise<TaskView> {
    const trapped = input.trap !== undefined;
    const task = await this.call(requester, (client) =>
      client.createTask({
        task: input.task,
        taskLabel: input.taskLabel,
        ...(input.trap === undefined ? {} : { requestFullContextOf: input.trap.requestFullContextOf }),
      }),
    );
    const record: TaskRecord = { id: task.id, requester, task: input.task, trapped };
    this.runtime(requester).tasks.unshift(record);
    this.persist();
    return taskView(task, record);
  }

  async getTask(requester: EmployeeId, taskId: Hex): Promise<TaskView> {
    const record = this.runtime(requester).tasks.find((t) => t.id === taskId);
    if (record === undefined) throw new EnclaveError("NOT_FOUND", `no task ${taskId} for ${requester}`);
    return taskView(await this.call(requester, (client) => client.getTask(taskId)), record);
  }

  async listTasks(requester: EmployeeId): Promise<TaskView[]> {
    const runtime = this.runtime(requester);
    if (runtime.tasks.length === 0) return [];
    const records = runtime.tasks.slice(0, MAX_TASKS_SHOWN);
    const views: TaskView[] = [];
    for (const record of records) {
      try {
        views.push(taskView(await this.call(requester, (client) => client.getTask(record.id)), record));
      } catch (error) {
        // A task the enclave no longer knows (its data was reset) is forgotten instead of breaking the thread.
        if (!(error instanceof BadgeApiError && error.code === "NOT_FOUND")) throw error;
        runtime.tasks = runtime.tasks.filter((t) => t.id !== record.id);
        this.persist();
      }
    }
    return views;
  }

  async listConsents(owner: EmployeeId): Promise<ConsentRequestView[]> {
    const consents = await this.call(owner, (client) => client.listConsents());
    const pending = consents.flatMap((c) => (c.kind === "ContextShare" ? [consentView(c, owner)] : []));
    return [...pending, ...this.runtime(owner).consentHistory];
  }

  async approveConsent(owner: EmployeeId, consentId: string, signature: Hex): Promise<void> {
    const request = await this.pendingConsent(owner, consentId);
    await this.call(owner, (client) => client.approveConsent(consentId, signature));
    this.remember(owner, { ...request, status: "approved" });
  }

  async rejectConsent(owner: EmployeeId, consentId: string): Promise<void> {
    const request = await this.pendingConsent(owner, consentId);
    await this.call(owner, (client) => client.rejectConsent(consentId));
    this.remember(owner, { ...request, status: "rejected" });
  }

  // ---- Grants, revocation, standing agreements ----

  async listGrants(owner: EmployeeId): Promise<GrantView[]> {
    const grants = await this.call(owner, (client) => client.listGrants());
    return grantViews(grants, await this.listPolicies(owner), owner);
  }

  async revoke(owner: EmployeeId, signed: SignedMessage<"ContextRevoke">): Promise<{ revoked: number }> {
    const result = await this.call(owner, (client) => client.revoke(signed));
    return { revoked: result.revokedGrants + result.revokedPolicies };
  }

  async createPolicy(owner: EmployeeId, signed: SignedMessage<"ContextPolicy">): Promise<PolicyView> {
    return policyView(await this.call(owner, (client) => client.createPolicy(signed)), owner);
  }

  async listPolicies(owner: EmployeeId): Promise<PolicyView[]> {
    const policies = await this.call(owner, (client) => client.listPolicies());
    return policies
      .map((policy) => policyView(policy, owner))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async contextTags(owner: EmployeeId): Promise<string[]> {
    return (await this.call(owner, (client) => client.me())).contextTags;
  }

  // ---- Desks ----

  async listDesks(viewer: EmployeeId): Promise<DeskView[]> {
    const identity = cachedDeskIdentity(viewer);
    const memberOf = EMPLOYEES[viewer].desks;
    const views: DeskView[] = [];
    for (const entry of DESK_DIRECTORY) {
      const desk = await this.call(viewer, (client) => client.getDesk(entry.id));
      const rule = EXCHANGE_RULES.find(
        (r) => r.sourceDesk === entry.id && memberOf.includes(r.recipientDesk),
      );
      views.push({
        id: entry.id,
        name: desk.name,
        directoryMembers: entry.directoryMembers,
        commitments: desk.commitments,
        root: desk.root,
        isMember: memberOf.includes(entry.id),
        joined: identity !== undefined && desk.commitments.includes(identity.commitment.toString()),
        allowedTopics: rule?.allowedTags ?? entry.allowedTopics,
        requestable: rule !== undefined,
      });
    }
    return views;
  }

  async joinDesk(employee: EmployeeId, signed: SignedMessage<"DeskJoin">): Promise<DeskView> {
    const desk = await this.call(employee, (client) => client.joinDesk(signed));
    const view = (await this.listDesks(employee)).find((d) => d.id === desk.id);
    if (view === undefined) throw new EnclaveError("NOT_FOUND", `desk ${desk.id} is not in the directory`);
    return view;
  }

  async createDeskRequest(
    requester: EmployeeId,
    input: { fromDesk: DeskId; toDesk: DeskId; task: string },
  ): Promise<DeskRequestView> {
    const request = await this.call(requester, (client) =>
      client.createDeskRequest({ fromDesk: input.fromDesk, task: input.task }),
    );
    const record: DeskRequestRecord = { id: request.id, task: input.task };
    this.runtime(requester).deskRequests.unshift(record);
    this.persist();
    return this.deskRequestView(requester, record);
  }

  async listDeskRequests(viewer: EmployeeId): Promise<DeskRequestsView> {
    const consents = await this.call(viewer, (client) => client.listConsents());
    const incoming = consents.flatMap((c) => (c.kind === "DeskShare" ? [deskConsentView(c, viewer)] : []));
    const outgoing: DeskRequestView[] = [];
    for (const record of this.runtime(viewer).deskRequests) {
      outgoing.push(await this.deskRequestView(viewer, record));
    }
    return { incoming, outgoing };
  }

  async approveDeskRequest(
    owner: EmployeeId,
    requestId: Hex,
    signed: SignedMessage<"DeskShare">,
    proof: DeskProofWire,
  ): Promise<void> {
    await this.call(owner, (client) =>
      client.approveDeskRequest(requestId, { signature: signed.signature, proof }),
    );
  }

  async rejectDeskRequest(owner: EmployeeId, requestId: Hex): Promise<void> {
    await this.call(owner, (client) => client.rejectDeskRequest(requestId));
  }

  // ---- Compliance ----

  async registerComplianceKey(viewer: EmployeeId, input: ComplianceKeyInput): Promise<EnrollmentView> {
    const key = await this.call(viewer, (client) => client.registerComplianceKey(input));
    this.runtime(viewer).complianceKey = {
      publicKey: key.publicKey,
      registeredAt: new Date(key.registeredAt * MS_PER_SECOND),
    };
    return this.enrollment(viewer);
  }

  async audit(viewer: EmployeeId): Promise<AuditView> {
    const first = await this.call(viewer, (client) => client.getAudit({ limit: AUDIT_PAGE_SIZE }));
    const entries = [...first.entries];
    let page = first.entries;
    while (page.length === AUDIT_PAGE_SIZE) {
      const afterSeq = page.at(-1)?.seq;
      page = (await this.call(viewer, (client) => client.getAudit({ afterSeq, limit: AUDIT_PAGE_SIZE })))
        .entries;
      entries.push(...page);
    }
    return auditView({ entries, chain: first.chain }, this.runtime(viewer).revealed);
  }

  async revealNotice(viewer: EmployeeId, input: RevealNoticeInput): Promise<SealedIdentityView> {
    await this.call(viewer, (client) => client.revealNotice({ seq: input.seq, reason: input.reason }));
    this.runtime(viewer).revealed.set(input.seq, input.signer);
    const sealed = (await this.audit(viewer)).sealed.find((s) => s.seq === input.seq);
    if (sealed === undefined)
      throw new EnclaveError("NOT_FOUND", `no desk share at audit entry ${input.seq}`);
    return sealed;
  }

  // ---- Internals ----

  private newClient(sessionKey?: LocalAccount): BadgeClient {
    return new BadgeClient({
      baseUrl: this.config.baseUrl,
      transport: "channel",
      attestationMode: this.config.attestationMode,
      ...(this.config.expectedComposeHash === undefined
        ? {}
        : { expectedComposeHash: this.config.expectedComposeHash }),
      ...(sessionKey === undefined ? {} : { sessionKey }),
    });
  }

  /** Rebuilds the runtimes from the persisted state; expired sessions are dropped (the enclave refuses them). */
  private restore(persisted: PersistedRuntime): Map<EmployeeId, EmployeeRuntime> {
    const runtimes = new Map<EmployeeId, EmployeeRuntime>();
    const nowSeconds = Date.now() / MS_PER_SECOND;
    for (const employee of EMPLOYEE_IDS) {
      const saved = persisted[employee];
      if (saved === undefined) continue;
      const runtime = newRuntime();
      if (saved.enrolledAt !== undefined) runtime.enrolledAt = new Date(saved.enrolledAt);
      if (saved.agent !== undefined && saved.agent.session.expiresAt > nowSeconds) {
        const account = privateKeyToAccount(saved.agent.privateKey);
        // A key that does not match its session would sign requests the enclave attributes to nobody.
        if (isAddressEqual(account.address, saved.agent.session.sessionKey)) {
          runtime.agent = { client: this.newClient(account), ...saved.agent };
        }
      }
      runtime.tasks = saved.tasks.map((task) => ({ ...task, requester: employee }));
      runtime.deskRequests = saved.deskRequests;
      runtimes.set(employee, runtime);
    }
    return runtimes;
  }

  /**
   * Writes what must survive a restart. A failed write only costs a new delegation after the next restart, so it is
   * reported in the server log rather than failing the employee's action.
   */
  private persist(): void {
    const employees: PersistedRuntime = {};
    for (const [employee, runtime] of this.runtimes) {
      employees[employee] = {
        ...(runtime.enrolledAt === undefined ? {} : { enrolledAt: runtime.enrolledAt.toISOString() }),
        ...(runtime.agent === undefined
          ? {}
          : { agent: { privateKey: runtime.agent.privateKey, session: runtime.agent.session } }),
        tasks: runtime.tasks.map(({ id, task, trapped }) => ({ id, task, trapped })),
        deskRequests: runtime.deskRequests,
      };
    }
    try {
      this.store.save(employees);
    } catch (error) {
      console.error(
        `[badge/web] could not persist the agent runtime to ${this.store.path}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * The compliance key lives in the enclave; it is re-read there (once found, cached) so an officer whose key is
   * already registered is not asked to sign it again, e.g. after this server restarted.
   */
  private async syncComplianceKey(employee: EmployeeId, runtime: EmployeeRuntime): Promise<void> {
    if (EMPLOYEES[employee].role !== "compliance" || runtime.complianceKey !== undefined) return;
    const key = await this.call(employee, (client) => client.getComplianceKey());
    if (key !== null) {
      runtime.complianceKey = {
        publicKey: key.publicKey,
        registeredAt: new Date(key.registeredAt * MS_PER_SECOND),
      };
    }
  }

  private runtime(employee: EmployeeId): EmployeeRuntime {
    let runtime = this.runtimes.get(employee);
    if (runtime === undefined) {
      runtime = newRuntime();
      this.runtimes.set(employee, runtime);
    }
    return runtime;
  }

  private activeAgent(employee: EmployeeId): EmployeeRuntime["agent"] {
    const agent = this.runtime(employee).agent;
    if (agent === undefined || agent.session.expiresAt * MS_PER_SECOND <= Date.now()) return undefined;
    return agent;
  }

  /**
   * Runs `work` with the employee's agent client. An enclave that no longer knows the session (expired, revoked,
   * data reset) drops it here, so the UI asks for a new delegation instead of failing on every refresh.
   */
  private async call<T>(employee: EmployeeId, work: (client: BadgeClient) => Promise<T>): Promise<T> {
    const agent = this.activeAgent(employee);
    if (agent === undefined) throw new AgentSessionMissingError(employee);
    try {
      return await work(agent.client);
    } catch (error) {
      if (error instanceof BadgeApiError && error.code === "SESSION_UNKNOWN") {
        this.runtime(employee).agent = undefined;
        this.persist();
        throw new AgentSessionMissingError(employee);
      }
      throw error;
    }
  }

  private async pendingConsent(owner: EmployeeId, consentId: string): Promise<ConsentRequestView> {
    const request = (await this.listConsents(owner)).find(
      (c) => c.id === consentId && c.status === "pending",
    );
    if (request === undefined) throw new EnclaveError("NOT_FOUND", `no pending consent ${consentId}`);
    return request;
  }

  private remember(owner: EmployeeId, decided: ConsentRequestView): void {
    const runtime = this.runtime(owner);
    runtime.consentHistory = [decided, ...runtime.consentHistory].slice(0, MAX_CONSENT_HISTORY);
  }

  private async deskRequestView(viewer: EmployeeId, record: DeskRequestRecord): Promise<DeskRequestView> {
    const request = await this.call(viewer, (client) => client.getDeskRequest(record.id));
    const toDesk = deskIdOf(request.sourceDesk);
    const view: DeskRequestView = {
      id: request.id,
      fromDesk: deskIdOf(request.fromDesk),
      toDesk,
      task: record.task,
      ruleLabel: request.ruleLabel,
      createdAt: isoFromSeconds(request.createdAt),
      status:
        request.status === "waiting_share"
          ? "pending"
          : request.status === "declined"
            ? "rejected"
            : request.status,
    };
    const [delivery] = request.deliveries;
    if (delivery !== undefined) {
      const proof = decodeDeskProof(delivery.proof);
      view.delivery = {
        excerpt: delivery.excerpt,
        sourceDesk: toDesk,
        nullifier: proof.nullifier.toString(),
        root: proof.merkleTreeRoot.toString(),
        proofVerified: await this.verifyDelivery(viewer, request.id, toDesk, delivery),
      };
    }
    return view;
  }

  /**
   * The requester checks the anonymous delivery itself: the excerpt hash is the proof's message, the request id its
   * scope, and the root must be the source desk's root as the enclave publishes it. Done once per request.
   */
  private async verifyDelivery(
    viewer: EmployeeId,
    requestId: Hex,
    sourceDesk: DeskId,
    delivery: { excerptHash: Hex; proof: DeskProofWire },
  ): Promise<boolean> {
    const runtime = this.runtime(viewer);
    const known = runtime.verifiedDeliveries.get(requestId);
    if (known !== undefined) return known;
    const { root } = await this.call(viewer, (client) => client.getDesk(sourceDesk));
    let verified = false;
    if (root !== null) {
      try {
        await verifyDeskProof(
          decodeDeskProof(delivery.proof),
          {
            expectedRoot: BigInt(root),
            expectedExcerptHash: delivery.excerptHash,
            expectedRequestId: requestId,
          },
          new InMemoryNullifierRegistry(),
        );
        verified = true;
      } catch (error) {
        if (!(error instanceof ZkError)) throw error;
        console.warn(`[badge/web] desk delivery ${requestId} failed verification: ${error.code}`);
      }
    }
    runtime.verifiedDeliveries.set(requestId, verified);
    return verified;
  }
}
