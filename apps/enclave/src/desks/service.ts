/**
 * Anonymous desk-to-desk sharing across a "Chinese wall". A member of one desk asks, under a seeded exchange rule,
 * for context held by members of another desk; each candidate owner is asked on their Ledger (DeskShare) and, if
 * they agree, proves desk membership with a Semaphore proof. The requester receives the excerpt and the proof,
 * never the owner's identity; the enclave seals that identity to the compliance officer's key in the audit log.
 */
import {
  checkDeskJoin,
  checkDeskShare,
  decodeBadgeMessage,
  decodeSignedMessage,
  encodeBadgeMessage,
  excerptLength,
  hashExcerpt,
  verifyBadgeSignature,
  type DeskShare,
} from "@badge/consent";
import {
  decodeDeskProof,
  deskGroupRoot,
  encodeDeskProof,
  verifyDeskProof,
  type DeskProofWire,
  type NullifierRegistry,
} from "@badge/zk";
import { hexToBytes, stringToBytes, type Hex } from "viem";
import { z } from "zod";
import type { Sealer } from "../audit";
import { nowSeconds } from "../clock";
import { NonceRepository, transaction } from "../db";
import type { Desk, ExchangeRule } from "../directory";
import { EnclaveError } from "../errors";
import { randomBytes32, randomNonce } from "../ids";
import type { MemoryStore } from "../memory/types";
import { ComplianceKeyRepository } from "../compliance/repository";
import type { DomainContext } from "../policy/engine";
import type { Caller } from "../security/types";
import { deviceLabel } from "../tasks/labels";
import { DeskMemberRepository, DeskRequestRepository, type DeskOfferRow } from "./repository";

/** A desk-share request stays answerable for a day, like a one-off consent. */
export const DESK_SHARE_TTL_SECONDS = 24n * 60n * 60n;
const MAX_DESK_TASK_CHARS = 2_000;
/** Who appears as the actor of an anonymous share in the audit log. */
const ANONYMOUS_ACTOR = "anonymous";

/** Body of POST /v1/desk-requests. */
export const CreateDeskRequestSchema = z.strictObject({
  fromDesk: z.string().min(1).max(64),
  task: z.string().trim().min(1).max(MAX_DESK_TASK_CHARS),
  /** Needed only when several rules let `fromDesk` receive context. */
  ruleId: z.string().min(1).max(64).optional(),
});
export type CreateDeskRequestInput = z.infer<typeof CreateDeskRequestSchema>;

export type DeskRequestStatus = "waiting_share" | "delivered" | "no_match" | "declined";

export interface DeskView {
  readonly id: string;
  readonly name: string;
  /** Registered identities (the anonymity set). */
  readonly members: number;
  readonly commitments: string[];
  /** Merkle root as a decimal string, null while nobody joined. */
  readonly root: string | null;
}

export interface DeskDelivery {
  readonly excerpt: string;
  readonly excerptHash: Hex;
  readonly proof: DeskProofWire;
  readonly sourceDesk: string;
  readonly ruleLabel: string;
}

export interface DeskRequestView {
  readonly id: Hex;
  readonly status: DeskRequestStatus;
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly fromDesk: string;
  readonly sourceDesk: string;
  readonly deliveries: DeskDelivery[];
}

export interface PendingDeskShareView {
  readonly offer: DeskOfferRow;
  readonly message: DeskShare;
}

export interface DeskServiceDeps {
  readonly ctx: DomainContext;
  readonly memory: MemoryStore;
  readonly sealer: Sealer;
  readonly nullifiers: NullifierRegistry;
}

export class DeskService {
  private readonly members: DeskMemberRepository;
  private readonly requests: DeskRequestRepository;
  private readonly nonces: NonceRepository;
  private readonly complianceKeys: ComplianceKeyRepository;

  constructor(private readonly deps: DeskServiceDeps) {
    this.members = new DeskMemberRepository(deps.ctx.db);
    this.requests = new DeskRequestRepository(deps.ctx.db);
    this.nonces = new NonceRepository(deps.ctx.db);
    this.complianceKeys = new ComplianceKeyRepository(deps.ctx.db);
  }

  private get ctx(): DomainContext {
    return this.deps.ctx;
  }

  private nowMs(): number {
    return this.ctx.clock.now().getTime();
  }

  /** Root of the desk's group, or null when nobody has joined yet. */
  private root(deskId: string): bigint | null {
    const commitments = this.members.commitments(deskId);
    return commitments.length === 0 ? null : deskGroupRoot(commitments);
  }

  /** GET /v1/desks/:desk: what a member needs to build their proof. */
  getDesk(deskId: string): DeskView {
    const desk = this.ctx.directory.requireDesk(deskId);
    const commitments = this.members.commitments(desk.id);
    return {
      id: desk.id,
      name: desk.name,
      members: commitments.length,
      commitments: commitments.map((c) => c.toString(10)),
      root: commitments.length === 0 ? null : deskGroupRoot(commitments).toString(10),
    };
  }

  /**
   * POST /v1/desks/join: registers the employee's anonymous identity commitment in a desk they belong to (per the
   * directory). The commitment is signed on the Ledger, so nobody can enroll an identity on someone's behalf.
   */
  async join(caller: Caller, body: unknown): Promise<DeskView> {
    const { message, signature } = decodeSignedMessage(body, "DeskJoin");
    const employee = this.ctx.directory.requireEmployee(caller.employeeId);
    const address = this.ctx.directory.requireAddress(employee);
    if (message.employee.toLowerCase() !== address.toLowerCase()) {
      throw new EnclaveError("FORBIDDEN", "a desk join must be signed by the caller's own Ledger");
    }
    await verifyBadgeSignature("DeskJoin", message, signature, address);
    checkDeskJoin(message);
    if (message.company !== this.ctx.directory.company.name) {
      throw new EnclaveError(
        "INVALID_REQUEST",
        `company "${message.company}" is not ${this.ctx.directory.company.name}`,
      );
    }
    const desk = this.ctx.directory.deskByName(message.deskName);
    if (!desk) throw new EnclaveError("NOT_FOUND", `no desk named "${message.deskName}"`);
    if (!this.ctx.directory.isDeskMember(employee.id, desk.id)) {
      throw new EnclaveError("FORBIDDEN", `${employee.id} is not a member of desk ${desk.id}`);
    }
    const nowMs = this.nowMs();
    transaction(this.ctx.db, () => {
      this.nonces.consume(address, message.nonce, "DeskJoin", nowMs);
      this.members.add({
        deskId: desk.id,
        employeeId: employee.id,
        commitment: message.identityCommitment,
        fixture: false,
        nowMs,
      });
      const commitments = this.members.commitments(desk.id);
      this.ctx.audit.append({
        type: "desk.join",
        actor: employee.id,
        subject: desk.id,
        data: {
          desk: desk.id,
          commitment: message.identityCommitment.toString(10),
          root: deskGroupRoot(commitments).toString(10),
          members: commitments.length,
        },
      });
    });
    return this.getDesk(desk.id);
  }

  /**
   * Registers a demo fixture's identity commitment (directory-only employees, see the dataset). Idempotent, and
   * run at boot before any request so fixtures always come first in the registration order.
   */
  registerFixture(deskId: string, employeeId: string, commitment: bigint): void {
    if (this.members.has(deskId, employeeId)) return;
    this.members.add({ deskId, employeeId, commitment, fixture: true, nowMs: this.nowMs() });
  }

  private pickRule(fromDesk: Desk, ruleId: string | undefined): ExchangeRule {
    const rules = this.ctx.directory.rulesForRecipient(fromDesk.id);
    const candidates = ruleId === undefined ? rules : rules.filter((rule) => rule.id === ruleId);
    const [rule, ...others] = candidates;
    if (!rule) throw new EnclaveError("NO_RULE", `no exchange rule lets desk ${fromDesk.id} receive context`);
    if (others.length > 0) throw new EnclaveError("INVALID_REQUEST", "several rules apply: pass ruleId");
    return rule;
  }

  /**
   * POST /v1/desk-requests: finds, under the exchange rule, the best excerpt of each source-desk member whose
   * context matches the rule's topics, and prepares one DeskShare per owner. Owners who have not joined the source
   * desk are skipped: they could not prove membership.
   */
  async createRequest(caller: Caller, input: CreateDeskRequestInput): Promise<DeskRequestView> {
    const { directory } = this.ctx;
    const fromDesk = directory.requireDesk(input.fromDesk);
    if (!directory.isDeskMember(caller.employeeId, fromDesk.id)) {
      throw new EnclaveError("FORBIDDEN", `${caller.employeeId} is not a member of desk ${fromDesk.id}`);
    }
    const rule = this.pickRule(fromDesk, input.ruleId);
    const sourceDesk = directory.requireDesk(rule.sourceDesk);
    const candidates = await this.deps.memory.findCandidates(input.task, { requesterId: caller.employeeId });
    const bestPerOwner = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      const eligible =
        candidate.scope === "personal" &&
        candidate.ownerId !== caller.employeeId &&
        directory.isDeskMember(candidate.ownerId, sourceDesk.id) &&
        this.members.has(sourceDesk.id, candidate.ownerId) &&
        candidate.tags.some((tag) => rule.allowedTags.includes(tag));
      // Candidates are ranked best first: the first eligible one per owner is that owner's best.
      if (eligible && !bestPerOwner.has(candidate.ownerId)) bestPerOwner.set(candidate.ownerId, candidate);
    }

    const requestId = randomBytes32();
    const nowMs = this.nowMs();
    const expiresAt = nowSeconds(this.ctx.clock) + DESK_SHARE_TTL_SECONDS;
    transaction(this.ctx.db, () => {
      this.requests.insertRequest({
        id: requestId,
        rule_id: rule.id,
        requester_id: caller.employeeId,
        from_desk: fromDesk.id,
        source_desk: sourceDesk.id,
        task: input.task,
        created_ms: nowMs,
      });
      for (const candidate of bestPerOwner.values()) {
        const label = deviceLabel(candidate.text);
        const message: DeskShare = {
          recipientDesk: fromDesk.name,
          excerptLabel: label,
          excerptLength: excerptLength(candidate.text),
          ruleLabel: rule.label,
          expiresAt,
          excerptHash: hashExcerpt(candidate.text),
          enclaveMeasurement: this.ctx.enclave.measurement,
          sourceDesk: sourceDesk.name,
          requestId,
          nonce: randomNonce(),
        };
        checkDeskShare(message, {
          now: nowSeconds(this.ctx.clock),
          enclaveMeasurement: this.ctx.enclave.measurement,
          excerptText: candidate.text,
        });
        this.requests.insertOffer({
          request_id: requestId,
          owner_id: candidate.ownerId,
          source_id: candidate.source.id,
          label,
          text: candidate.text,
          excerpt_hash: message.excerptHash,
          length: message.excerptLength,
          message: JSON.stringify(encodeBadgeMessage("DeskShare", message)),
          created_ms: nowMs,
        });
      }
      this.ctx.audit.append({
        type: "desk.request",
        actor: caller.employeeId,
        subject: requestId,
        data: {
          requestId,
          ruleId: rule.id,
          fromDesk: fromDesk.id,
          sourceDesk: sourceDesk.id,
          offers: bestPerOwner.size,
        },
      });
    });
    return this.getRequest(caller, requestId);
  }

  /** Pending desk shares the caller is asked to sign. */
  pendingShares(caller: Caller): PendingDeskShareView[] {
    return this.requests.pendingForOwner(caller.employeeId).map((offer) => ({
      offer,
      message: decodeBadgeMessage("DeskShare", JSON.parse(offer.message)),
    }));
  }

  private requirePendingOffer(caller: Caller, requestId: Hex): DeskOfferRow {
    const offer = this.requests.offer(requestId, caller.employeeId);
    if (!offer) throw new EnclaveError("NOT_FOUND", `no desk share ${requestId} for ${caller.employeeId}`);
    if (offer.status !== "pending") throw new EnclaveError("NOT_PENDING", `desk share is ${offer.status}`);
    return offer;
  }

  /**
   * POST /v1/desk-requests/:id/approve. Checks, in order: the DeskShare signature by the caller's Ledger and their
   * membership of the source desk, the intrinsic checks against the stored excerpt, that a compliance key exists
   * (no escrow, no anonymous share), the nonce, then the ZK proof (root of the source desk, excerpt, request,
   * fresh nullifier). Only then is the excerpt delivered and the sealed signer identity logged.
   */
  async approve(
    caller: Caller,
    requestId: Hex,
    signature: Hex,
    proofJson: unknown,
  ): Promise<{ requestId: Hex }> {
    const offer = this.requirePendingOffer(caller, requestId);
    const request = this.requests.getRequest(requestId);
    if (!request) throw new Error(`desk offer references missing request ${requestId}`);
    const owner = this.ctx.directory.requireEmployee(caller.employeeId);
    const address = this.ctx.directory.requireAddress(owner);
    if (!this.ctx.directory.isDeskMember(owner.id, request.source_desk)) {
      throw new EnclaveError("FORBIDDEN", `${owner.id} is not a member of desk ${request.source_desk}`);
    }
    const message = decodeBadgeMessage("DeskShare", JSON.parse(offer.message));
    await verifyBadgeSignature("DeskShare", message, signature, address);
    checkDeskShare(message, {
      now: nowSeconds(this.ctx.clock),
      enclaveMeasurement: this.ctx.enclave.measurement,
      excerptText: offer.text,
    });
    const complianceKey = this.complianceKeys.latest();
    if (!complianceKey) {
      throw new EnclaveError(
        "COMPLIANCE_KEY_MISSING",
        "no compliance key registered: anonymous shares are disabled",
      );
    }
    // Checked before the proof so that a replay cannot burn the member's nullifier for this request.
    if (this.nonces.isUsed(address, message.nonce)) {
      throw new EnclaveError("NONCE_REUSED", `nonce ${message.nonce} of ${address} was already used`);
    }
    const proof = decodeDeskProof(proofJson);
    const root = this.root(request.source_desk);
    if (root === null)
      throw new EnclaveError("FORBIDDEN", `desk ${request.source_desk} has no registered member`);
    const { nullifier } = await verifyDeskProof(
      proof,
      { expectedRoot: root, expectedExcerptHash: message.excerptHash, expectedRequestId: request.id },
      this.deps.nullifiers,
    );
    const sealedSigner = await this.deps.sealer.seal(
      hexToBytes(complianceKey.public_key),
      stringToBytes(
        JSON.stringify({
          employeeId: owner.id,
          address,
          signature,
          requestId: request.id,
          excerptHash: message.excerptHash,
          nullifier: nullifier.toString(10),
        }),
      ),
    );
    const nowMs = this.nowMs();
    transaction(this.ctx.db, () => {
      if (!this.requests.deliver(offer.id, JSON.stringify(encodeDeskProof(proof)), nullifier, nowMs)) {
        throw new EnclaveError("NOT_PENDING", "desk share was decided concurrently");
      }
      this.nonces.consume(address, message.nonce, "DeskShare", nowMs);
      this.ctx.audit.append({
        type: "desk.share",
        actor: ANONYMOUS_ACTOR,
        subject: request.id,
        data: {
          requestId: request.id,
          ruleId: request.rule_id,
          sourceDesk: request.source_desk,
          recipientDesk: request.from_desk,
          excerptHash: message.excerptHash,
          nullifier: nullifier.toString(10),
          complianceKeyId: complianceKey.id,
          sealedSigner,
        },
      });
    });
    return { requestId: request.id };
  }

  /** POST /v1/desk-requests/:id/reject: declining needs no signature and is not logged with the owner's name. */
  reject(caller: Caller, requestId: Hex): { requestId: Hex; status: "rejected" } {
    const offer = this.requirePendingOffer(caller, requestId);
    if (!this.requests.reject(offer.id, this.nowMs())) {
      throw new EnclaveError("NOT_PENDING", "desk share was decided concurrently");
    }
    return { requestId: offer.request_id, status: "rejected" };
  }

  /** GET /v1/desk-requests/:id (requester only): anonymous deliveries, never the owners. */
  getRequest(caller: Caller, requestId: Hex): DeskRequestView {
    const request = this.requests.getRequest(requestId);
    if (!request || request.requester_id !== caller.employeeId) {
      throw new EnclaveError("NOT_FOUND", `no desk request ${requestId}`);
    }
    const rule = this.ctx.directory.exchangeRules().find((r) => r.id === request.rule_id);
    if (!rule) throw new Error(`desk request references unknown rule ${request.rule_id}`);
    const offers = this.requests.offersOf(request.id);
    const delivered = offers.filter((o) => o.status === "delivered");
    const status: DeskRequestStatus =
      offers.length === 0
        ? "no_match"
        : delivered.length > 0
          ? "delivered"
          : offers.some((o) => o.status === "pending")
            ? "waiting_share"
            : "declined";
    const sourceDesk = this.ctx.directory.requireDesk(request.source_desk);
    return {
      id: request.id,
      status,
      ruleId: rule.id,
      ruleLabel: rule.label,
      fromDesk: request.from_desk,
      sourceDesk: sourceDesk.id,
      // Ordered by excerpt hash, not by delivery time: the order must not hint at who answered first.
      deliveries: delivered
        .sort((a, b) => a.excerpt_hash.localeCompare(b.excerpt_hash))
        .map((o) => ({
          excerpt: o.text,
          excerptHash: o.excerpt_hash,
          proof: encodeDeskProof(decodeDeskProof(JSON.parse(o.proof ?? "null"))),
          sourceDesk: sourceDesk.id,
          ruleLabel: rule.label,
        })),
    };
  }
}
