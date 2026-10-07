/**
 * Anonymous desk-to-desk sharing through the API, with real Semaphore proofs (needs the depth-16 artifacts:
 * infra/setup.sh, or BADGE_ZK_ARTIFACTS_DIR). About 1 s per proof.
 */
import { complianceKeyRegistrationMessage, openSealed, SEALED_BOX_ALGORITHM } from "@badge/attest";
import { deskIdentityDeriveMessage, type DeskShare } from "@badge/consent";
import {
  buildDeskGroup,
  createDeskProof,
  deriveDeskIdentity,
  encodeDeskProof,
  type Identity,
} from "@badge/zk";
import { decodeBadgeMessage } from "@badge/consent";
import type { Hex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import { fixtureCommitment } from "../src/desks";
import { call, onboard } from "./flows";
import {
  complianceKeyPair,
  createHarness,
  ledgers,
  nextNonce,
  signedWire,
  signTyped,
  type DemoEmployee,
  type Harness,
} from "./harness";

const PROOF_TIMEOUT_MS = 60_000;
const MARKET_TASK = { fromDesk: "origination", task: "Tendances marche-capteurs et prix des composants" };

async function deskIdentity(who: DemoEmployee): Promise<Identity> {
  return deriveDeskIdentity(await ledgers[who].signMessage({ message: deskIdentityDeriveMessage("Acme") }));
}

async function joinDesk(h: Harness, who: DemoEmployee, deskName: string, identity: Identity) {
  return call(h, "POST", "/v1/desks/join", {
    as: who,
    body: await signedWire(ledgers[who], "DeskJoin", {
      deskName,
      company: "Acme",
      identityCommitment: identity.commitment,
      employee: ledgers[who].address,
      nonce: nextNonce(),
    }),
  });
}

async function registerComplianceKey(h: Harness) {
  const { publicKey } = await complianceKeyPair();
  const signature = await ledgers.chloe.signMessage({
    message: complianceKeyRegistrationMessage("Acme", publicKey),
  });
  return call(h, "POST", "/v1/compliance/key", { as: "chloe", body: { publicKey, signature } });
}

async function pendingDeskShare(
  h: Harness,
  who: DemoEmployee,
): Promise<{ requestId: Hex; message: DeskShare }> {
  const consents: Array<{ kind: string; id: Hex; message: unknown }> = (
    await call(h, "GET", "/v1/consents", { as: who })
  ).json.consents;
  const share = consents.find((c) => c.kind === "DeskShare");
  if (!share) throw new Error(`no desk share for ${who}`);
  return { requestId: share.id, message: decodeBadgeMessage("DeskShare", share.message) };
}

async function proofFor(
  h: Harness,
  identity: Identity,
  share: { requestId: Hex; message: DeskShare },
  desk = "research",
) {
  const { commitments } = (await call(h, "GET", `/v1/desks/${desk}`, { as: "bob" })).json;
  const group = buildDeskGroup(commitments.map((c: string) => BigInt(c)));
  return encodeDeskProof(
    await createDeskProof({
      identity,
      group,
      excerptHash: share.message.excerptHash,
      requestId: share.requestId,
    }),
  );
}

describe("desk membership", () => {
  it("registers the demo fixtures at boot so the Research desk starts with an anonymity set", async () => {
    const h = await createHarness();
    await onboard(h, "bob");
    const desk = (await call(h, "GET", "/v1/desks/research", { as: "bob" })).json;
    expect(desk.members).toBe(2);
    expect(desk.commitments[0]).toBe(
      (await fixtureCommitment("badge-demo-desk-fixture:david", "Acme")).toString(),
    );
  });

  it("lets Bob join Research but refuses a desk he does not belong to, and a second join", async () => {
    const h = await createHarness();
    await onboard(h, "bob");
    const identity = await deskIdentity("bob");
    expect((await joinDesk(h, "bob", "Origination", identity)).json.error.code).toBe("FORBIDDEN");
    const joined = await joinDesk(h, "bob", "Research", identity);
    expect(joined.status).toBe(201);
    expect(joined.json.members).toBe(3);
    expect((await joinDesk(h, "bob", "Research", identity)).json.error.code).toBe("ALREADY_EXISTS");
  });
});

describe("anonymous desk share", () => {
  let h: Harness;
  let bob: Identity;

  beforeAll(async () => {
    h = await createHarness();
    await onboard(h, "alice", "bob", "chloe");
    bob = await deskIdentity("bob");
    expect((await joinDesk(h, "bob", "Research", bob)).status).toBe(201);
    expect((await joinDesk(h, "alice", "Origination", await deskIdentity("alice"))).status).toBe(201);
  });

  it("refuses a request from someone outside the asking desk", async () => {
    const response = await call(h, "POST", "/v1/desk-requests", { as: "bob", body: MARKET_TASK });
    expect(response.json.error.code).toBe("FORBIDDEN");
  });

  it("prepares a DeskShare for Bob under the exchange rule, without naming him to Alice", async () => {
    const created = await call(h, "POST", "/v1/desk-requests", { as: "alice", body: MARKET_TASK });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ status: "waiting_share", ruleLabel: "Regle 4 - marche capteurs" });
    expect(JSON.stringify(created.json)).not.toMatch(/bob/i);
    const share = await pendingDeskShare(h, "bob");
    expect(share.message).toMatchObject({ recipientDesk: "Origination", sourceDesk: "Research" });
  });

  it("refuses the approval while no compliance key is registered", async () => {
    const share = await pendingDeskShare(h, "bob");
    const signature = await signTyped(ledgers.bob, "DeskShare", share.message);
    const response = await call(h, "POST", `/v1/desk-requests/${share.requestId}/approve`, {
      as: "bob",
      body: { signature, proof: {} },
    });
    expect(response.json.error.code).toBe("COMPLIANCE_KEY_MISSING");
    expect((await registerComplianceKey(h)).status).toBe(201);
  });

  it("refuses a DeskShare signed by anyone but the asked member, and approvals by non-members", async () => {
    const share = await pendingDeskShare(h, "bob");
    const forged = await signTyped(ledgers.alice, "DeskShare", share.message);
    const response = await call(h, "POST", `/v1/desk-requests/${share.requestId}/approve`, {
      as: "bob",
      body: { signature: forged, proof: {} },
    });
    expect(response.json.error.code).toBe("SIGNATURE_MISMATCH");
    const outsider = await call(h, "POST", `/v1/desk-requests/${share.requestId}/approve`, {
      as: "alice",
      body: { signature: forged, proof: {} },
    });
    expect(outsider.json.error.code).toBe("NOT_FOUND");
  });

  it(
    "refuses a proof from another desk's group (wrong root)",
    async () => {
      const share = await pendingDeskShare(h, "bob");
      const signature = await signTyped(ledgers.bob, "DeskShare", share.message);
      // Alice is a genuine member of Origination: a valid proof, for the wrong desk.
      const proof = await proofFor(h, await deskIdentity("alice"), share, "origination");
      const response = await call(h, "POST", `/v1/desk-requests/${share.requestId}/approve`, {
        as: "bob",
        body: { signature, proof },
      });
      expect(response.status).toBe(422);
      expect(response.json.error.code).toBe("WRONG_ROOT");
    },
    PROOF_TIMEOUT_MS,
  );

  it(
    "delivers the excerpt and the proof to Alice, anonymously, and seals Bob's identity for compliance",
    async () => {
      const share = await pendingDeskShare(h, "bob");
      const signature = await signTyped(ledgers.bob, "DeskShare", share.message);
      const proof = await proofFor(h, bob, share);
      const approved = await call(h, "POST", `/v1/desk-requests/${share.requestId}/approve`, {
        as: "bob",
        body: { signature, proof },
      });
      expect(approved.json).toEqual({ requestId: share.requestId, status: "delivered" });

      const delivery = (await call(h, "GET", `/v1/desk-requests/${share.requestId}`, { as: "alice" })).json;
      expect(delivery.status).toBe("delivered");
      expect(delivery.deliveries[0].excerpt).toContain("marché européen des capteurs");
      expect(delivery.deliveries[0].proof.merkleTreeDepth).toBe(16);
      expect(JSON.stringify(delivery)).not.toMatch(/bob|58A57|Durand/i);
      expect((await call(h, "GET", `/v1/desk-requests/${share.requestId}`, { as: "bob" })).status).toBe(404);

      const audit = (await call(h, "GET", "/v1/audit", { as: "chloe" })).json;
      const entry = audit.entries.find((e: { type: string }) => e.type === "desk.share");
      expect(entry.actor).toBe("anonymous");
      expect(entry.data.sealedSigner.alg).toBe(SEALED_BOX_ALGORITHM);
      expect(JSON.stringify(entry)).not.toMatch(/"bob"|58A57/i);
      expect(audit.chain.valid).toBe(true);
      // Only the compliance officer's Ledger-derived key opens the signer's identity.
      const { secretKey } = await complianceKeyPair();
      const signer = JSON.parse(new TextDecoder().decode(openSealed(secretKey, entry.data.sealedSigner)));
      expect(signer).toMatchObject({ employeeId: "bob", address: ledgers.bob.address });

      const notice = await call(h, "POST", "/v1/audit/reveal-notice", {
        as: "chloe",
        body: { seq: entry.seq, reason: "Controle interne" },
      });
      expect(notice.status).toBe(201);
      expect(
        (
          await call(h, "POST", "/v1/audit/reveal-notice", {
            as: "alice",
            body: { seq: entry.seq, reason: "x" },
          })
        ).status,
      ).toBe(403);
    },
    PROOF_TIMEOUT_MS,
  );

  it(
    "refuses to deliver twice for the same request (nullifier and decision are single-use)",
    async () => {
      const created = (await call(h, "POST", "/v1/desk-requests", { as: "alice", body: MARKET_TASK })).json;
      const share = await pendingDeskShare(h, "bob");
      expect(share.requestId).toBe(created.id);
      const signature = await signTyped(ledgers.bob, "DeskShare", share.message);
      const proof = await proofFor(h, bob, share);
      // Burn the nullifier as if the same member had already answered this request.
      expect(await h.nullifiers.consume(BigInt(share.requestId), BigInt(proof.nullifier))).toBe(true);
      const response = await call(h, "POST", `/v1/desk-requests/${share.requestId}/approve`, {
        as: "bob",
        body: { signature, proof },
      });
      expect(response.status).toBe(409);
      expect(response.json.error.code).toBe("NULLIFIER_REUSED");
    },
    PROOF_TIMEOUT_MS,
  );
});
