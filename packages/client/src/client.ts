/**
 * Typed client of the enclave API (docs/enclave-api.md), shared by the web app, the MCP server and the demo script.
 */
import type { AttestationMode, AttestationResult, VerifiedAttestation } from "@badge/attest";
import { encodeSignedMessage, type BadgeMessageKind, type SignedMessage } from "@badge/consent";
import { deskProofSchema, type DeskProofWire } from "@badge/zk/wire";
import type { Hex, LocalAccount } from "viem";
import { z } from "zod";
import {
  auditEntrySchema,
  auditLogSchema,
  complianceKeySchema,
  consentDecisionSchema,
  consentListSchema,
  deskRequestSchema,
  deskSchema,
  enrollResponseSchema,
  measurementSchema,
  policyListSchema,
  policySchema,
  revocationResultSchema,
  sessionSchema,
  taskSchema,
  type AuditEntry,
  type AuditLog,
  type ComplianceKey,
  type ConsentDecision,
  type ConsentRequest,
  type Desk,
  type DeskRequest,
  type EnrollResponse,
  type Measurement,
  type Policy,
  type RevocationResult,
  type Session,
  type Task,
} from "./api-schemas";
import type { InnerRequest } from "./channel-wire";
import { BadgeApiError } from "./errors";
import { BADGE_AUTH_HEADERS, bodyBytes, canonicalRequest } from "./request-auth";
import {
  ChannelTransport,
  errorFromResponse,
  PlainTransport,
  type FetchLike,
  type Transport,
} from "./transport";

export interface BadgeClientOptions {
  /** Enclave origin, e.g. `http://127.0.0.1:8787` (no trailing slash needed). */
  baseUrl: string;
  /** Agent session key. Only `enroll`, `openSession` and `measurement` work without one. */
  sessionKey?: LocalAccount;
  /** `channel` in production; `plain` for local development. */
  transport: "plain" | "channel";
  /** How to verify the enclave quote (channel transport). */
  attestationMode: AttestationMode;
  /** Pinned compose hash (hex); mandatory with `attestationMode: "tdx"`. */
  expectedComposeHash?: string;
  /** Called with every attestation result (also failures), e.g. to render the "TEE verified / simulated" badge. */
  onAttestation?: (result: AttestationResult) => void;
  /** Defaults to the global fetch. */
  fetch?: FetchLike;
  /** Unix milliseconds; injected for tests. */
  now?: () => number;
}

type Method = InnerRequest["method"];

interface CallOptions<T> {
  method: Method;
  path: string;
  body?: unknown;
  /** Unauthenticated routes (enroll, sessions, measurement) are sent without a session signature. */
  authenticated: boolean;
  schema: z.ZodType<T>;
}

/** Body of `POST /v1/tasks`. */
export interface CreateTaskInput {
  /** Free-text task given to the agent (stays in the enclave). */
  task: string;
  /** Short ASCII label, shown on the owners' Ledgers ("Tache"). */
  taskLabel: string;
}

/** Body of `POST /v1/desk-requests`. */
export interface CreateDeskRequestInput {
  /** The requester's own desk. */
  fromDesk: string;
  task: string;
}

/** Body of `POST /v1/desk-requests/:id/approve`. */
export interface ApproveDeskRequestInput {
  /** The owner's Ledger signature of the request's DeskShare message. */
  signature: Hex;
  /** Semaphore proof: message = excerptHash, scope = request id. */
  proof: DeskProofWire;
}

/** Body of `POST /v1/compliance/key`. */
export interface RegisterComplianceKeyInput {
  /** X25519 public key (hex, no prefix) derived with `complianceKeyFromSignature`. */
  publicKey: string;
  /** Ledger EIP-191 signature of `complianceKeyRegistrationMessage(publicKey)`. */
  signature: Hex;
}

/** Body of `POST /v1/audit/reveal-notice`. */
export interface RevealNoticeInput {
  /** Audit entry whose sealed signer identity was decrypted. */
  seq: number;
  reason: string;
}

const segment = (value: string) => encodeURIComponent(value);

/** Typed, validated access to every enclave route. All failures are {@link BadgeApiError}. */
export class BadgeClient {
  private readonly transport: Transport;
  private readonly channel: ChannelTransport | undefined;
  private readonly now: () => number;
  private lastTimestamp = 0;

  constructor(private readonly options: BadgeClientOptions) {
    const baseUrl = options.baseUrl.replace(/\/+$/, "");
    const fetchFn: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.now = options.now ?? Date.now;
    if (options.transport === "channel") {
      this.channel = new ChannelTransport({
        baseUrl,
        fetchFn,
        attestationMode: options.attestationMode,
        ...(options.expectedComposeHash === undefined
          ? {}
          : { expectedComposeHash: options.expectedComposeHash }),
        ...(options.onAttestation === undefined ? {} : { onAttestation: options.onAttestation }),
      });
      this.transport = this.channel;
    } else {
      this.transport = new PlainTransport(baseUrl, fetchFn);
    }
  }

  /** Latest attestation result (channel transport), undefined before the first call or in plain mode. */
  get attestation(): AttestationResult | undefined {
    return this.channel?.attestation;
  }

  /**
   * Opens and verifies the attested channel now (otherwise done on the first call).
   * @throws BadgeApiError("invalid_argument") in plain mode, ("attestation_failed") if the enclave is not trusted.
   */
  async connect(): Promise<VerifiedAttestation> {
    if (!this.channel)
      throw new BadgeApiError(0, "invalid_argument", "connect() needs the channel transport");
    return this.channel.connect();
  }

  // ---- Onboarding (Ledger-signed, no session yet) ----

  /** `POST /v1/enroll`: binds the directory identity to the Ledger address. */
  enroll(signed: SignedMessage<"EmployeeEnroll">): Promise<EnrollResponse> {
    return this.signedCall("/v1/enroll", signed, false, enrollResponseSchema);
  }

  /** `POST /v1/sessions`: registers the agent session key (see `createAgentSession`). */
  openSession(signed: SignedMessage<"AgentSession">): Promise<Session> {
    return this.signedCall("/v1/sessions", signed, false, sessionSchema);
  }

  // ---- Tasks and consents ----

  /** `POST /v1/tasks`: the caller's agent asks for a brief. */
  createTask(input: CreateTaskInput): Promise<Task> {
    return this.call({
      method: "POST",
      path: "/v1/tasks",
      body: input,
      authenticated: true,
      schema: taskSchema,
    });
  }

  /** `GET /v1/tasks/:id`: status, and the brief once nothing is pending. */
  getTask(taskId: string): Promise<Task> {
    return this.call({
      method: "GET",
      path: `/v1/tasks/${segment(taskId)}`,
      authenticated: true,
      schema: taskSchema,
    });
  }

  /** `GET /v1/consents`: requests where the caller is the owner, with the exact message to sign. */
  async listConsents(): Promise<ConsentRequest[]> {
    const list = await this.call({
      method: "GET",
      path: "/v1/consents",
      authenticated: true,
      schema: consentListSchema,
    });
    return list.consents;
  }

  /** `POST /v1/consents/:id/approve` with the owner's Ledger signature of the ContextShare. */
  approveConsent(consentId: string, signature: Hex): Promise<ConsentDecision> {
    return this.call({
      method: "POST",
      path: `/v1/consents/${segment(consentId)}/approve`,
      body: { signature },
      authenticated: true,
      schema: consentDecisionSchema,
    });
  }

  /** `POST /v1/consents/:id/reject`. */
  rejectConsent(consentId: string): Promise<ConsentDecision> {
    return this.call({
      method: "POST",
      path: `/v1/consents/${segment(consentId)}/reject`,
      body: {},
      authenticated: true,
      schema: consentDecisionSchema,
    });
  }

  /** `POST /v1/revocations` with a Ledger-signed ContextRevoke. */
  revoke(signed: SignedMessage<"ContextRevoke">): Promise<RevocationResult> {
    return this.signedCall("/v1/revocations", signed, true, revocationResultSchema);
  }

  // ---- Standing agreements ----

  /** `POST /v1/policies` with a Ledger-signed ContextPolicy. */
  createPolicy(signed: SignedMessage<"ContextPolicy">): Promise<Policy> {
    return this.signedCall("/v1/policies", signed, true, policySchema);
  }

  /** `GET /v1/policies`: the caller's policies with usage counts. */
  async listPolicies(): Promise<Policy[]> {
    const list = await this.call({
      method: "GET",
      path: "/v1/policies",
      authenticated: true,
      schema: policyListSchema,
    });
    return list.policies;
  }

  // ---- Desks (anonymous sharing) ----

  /** `POST /v1/desks/join` with a Ledger-signed DeskJoin. */
  joinDesk(signed: SignedMessage<"DeskJoin">): Promise<Desk> {
    return this.signedCall("/v1/desks/join", signed, true, deskSchema);
  }

  /** `GET /v1/desks/:desk`: members count, commitments and Merkle root (to build proofs). */
  getDesk(desk: string): Promise<Desk> {
    return this.call({
      method: "GET",
      path: `/v1/desks/${segment(desk)}`,
      authenticated: true,
      schema: deskSchema,
    });
  }

  /** `POST /v1/desk-requests`. */
  createDeskRequest(input: CreateDeskRequestInput): Promise<DeskRequest> {
    return this.call({
      method: "POST",
      path: "/v1/desk-requests",
      body: input,
      authenticated: true,
      schema: deskRequestSchema,
    });
  }

  /** `POST /v1/desk-requests/:id/approve` with the DeskShare signature and the membership proof. */
  async approveDeskRequest(requestId: string, input: ApproveDeskRequestInput): Promise<DeskRequest> {
    const proof = deskProofSchema.safeParse(input.proof);
    if (!proof.success) {
      throw new BadgeApiError(0, "invalid_argument", `malformed desk proof: ${z.prettifyError(proof.error)}`);
    }
    return this.call({
      method: "POST",
      path: `/v1/desk-requests/${segment(requestId)}/approve`,
      body: { signature: input.signature, proof: proof.data },
      authenticated: true,
      schema: deskRequestSchema,
    });
  }

  /** `GET /v1/desk-requests/:id`: anonymous delivery to the requester. */
  getDeskRequest(requestId: string): Promise<DeskRequest> {
    return this.call({
      method: "GET",
      path: `/v1/desk-requests/${segment(requestId)}`,
      authenticated: true,
      schema: deskRequestSchema,
    });
  }

  // ---- Compliance ----

  /** `POST /v1/compliance/key` (compliance role). */
  registerComplianceKey(input: RegisterComplianceKeyInput): Promise<ComplianceKey> {
    return this.call({
      method: "POST",
      path: "/v1/compliance/key",
      body: input,
      authenticated: true,
      schema: complianceKeySchema,
    });
  }

  /** `GET /v1/audit` (compliance role): entries and chain verification. */
  getAudit(): Promise<AuditLog> {
    return this.call({ method: "GET", path: "/v1/audit", authenticated: true, schema: auditLogSchema });
  }

  /** `POST /v1/audit/reveal-notice`: logs a client-side de-anonymisation. Returns the new audit entry. */
  revealNotice(input: RevealNoticeInput): Promise<AuditEntry> {
    return this.call({
      method: "POST",
      path: "/v1/audit/reveal-notice",
      body: input,
      authenticated: true,
      schema: auditEntrySchema,
    });
  }

  // ---- Enclave identity ----

  /** `GET /v1/attestation/measurement`: the bytes32 every signed message must carry. */
  measurement(): Promise<Measurement> {
    return this.call({
      method: "GET",
      path: "/v1/attestation/measurement",
      authenticated: false,
      schema: measurementSchema,
    });
  }

  private async signedCall<K extends BadgeMessageKind, T>(
    path: string,
    signed: SignedMessage<K>,
    authenticated: boolean,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let body: unknown;
    try {
      body = encodeSignedMessage(signed);
    } catch (error) {
      throw new BadgeApiError(0, "invalid_argument", `cannot encode signed ${signed.kind}`, { cause: error });
    }
    return this.call({ method: "POST", path, body, authenticated, schema });
  }

  private async call<T>(options: CallOptions<T>): Promise<T> {
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const headers: InnerRequest["headers"] = body === null ? {} : { "content-type": "application/json" };
    if (options.authenticated)
      Object.assign(headers, await this.authHeaders(options.method, options.path, body));
    const response = await this.transport.send({ method: options.method, path: options.path, headers, body });
    if (response.status < 200 || response.status >= 300)
      throw errorFromResponse(response.status, response.body);
    let value: unknown;
    try {
      value = JSON.parse(response.body);
    } catch (error) {
      throw new BadgeApiError(response.status, "bad_response", `${options.path}: response is not JSON`, {
        cause: error,
      });
    }
    const checked = options.schema.safeParse(value);
    if (!checked.success) {
      throw new BadgeApiError(
        response.status,
        "bad_response",
        `${options.path}: unexpected response shape: ${z.prettifyError(checked.error)}`,
        { cause: checked.error },
      );
    }
    return checked.data;
  }

  private async authHeaders(
    method: Method,
    path: string,
    body: string | null,
  ): Promise<Record<string, string>> {
    const account = this.options.sessionKey;
    if (!account) {
      throw new BadgeApiError(
        0,
        "no_session_key",
        `${method} ${path} needs a session key (openSession first)`,
      );
    }
    // Strictly increasing: the enclave rejects an identical (key, request, ts) as a replay, so two identical calls
    // within the same millisecond (e.g. polling) must still differ.
    const timestamp = Math.max(this.now(), this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    const message = canonicalRequest({
      method,
      pathWithQuery: path,
      timestamp,
      body: bodyBytes(body),
    });
    const signature = await account.signMessage({ message });
    return {
      [BADGE_AUTH_HEADERS.session]: account.address,
      [BADGE_AUTH_HEADERS.timestamp]: String(timestamp),
      [BADGE_AUTH_HEADERS.signature]: signature,
    };
  }
}
