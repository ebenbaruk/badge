/**
 * Policy engine, fail-closed cases: every signed message that is wrong in any way is refused with a typed code,
 * and nothing is granted.
 */
import { encodeBadgeMessage, toDeviceAscii, type ContextPolicy } from "@badge/consent";
import { zeroHash, type Hex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { call, nowSec, onboard, pendingShares, refreshSessions } from "./flows";
import {
  agents,
  createHarness,
  ledgers,
  MEASUREMENT,
  nextNonce,
  OTHER_MEASUREMENT,
  signedWire,
  signTyped,
  type Harness,
} from "./harness";

const ORION_TASK = { task: "brief orion", taskLabel: "Brief Orion" };
const DAY_MS = 24 * 3600 * 1000;

async function orionTask(h: Harness) {
  return (await call(h, "POST", "/v1/tasks", { as: "alice", body: ORION_TASK })).json;
}

function policy(h: Harness, overrides: Partial<ContextPolicy> = {}): ContextPolicy {
  return {
    granteeTeam: "Ventes",
    contextTag: "orion",
    purpose: "Briefs clients",
    maxExcerptLength: 500,
    expiresAt: nowSec(h) + 30n * 24n * 3600n,
    enclaveMeasurement: MEASUREMENT,
    owner: ledgers.bob.address,
    nonce: nextNonce(),
    ...overrides,
  };
}

async function postPolicy(
  h: Harness,
  message: ContextPolicy,
  signer = ledgers.bob,
  as: "bob" | "alice" = "bob",
) {
  return call(h, "POST", "/v1/policies", { as, body: await signedWire(signer, "ContextPolicy", message) });
}

describe("enrollment and sessions", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });

  it("refuses an enrollment signed by another key", async () => {
    const response = await call(h, "POST", "/v1/enroll", {
      body: await signedWire(ledgers.alice, "EmployeeEnroll", {
        company: "Acme",
        employeeName: "Bob Durand",
        team: "Grands comptes",
        enclaveMeasurement: MEASUREMENT,
        employee: ledgers.bob.address,
        issuedAt: nowSec(h),
        nonce: 1n,
      }),
    });
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe("SIGNATURE_MISMATCH");
  });

  it("refuses an identity that differs from the directory, and a stale enrollment", async () => {
    const enrollAs = async (employeeName: string, issuedAt: bigint) =>
      call(h, "POST", "/v1/enroll", {
        body: await signedWire(ledgers.alice, "EmployeeEnroll", {
          company: "Acme",
          employeeName,
          team: "Ventes",
          enclaveMeasurement: MEASUREMENT,
          employee: ledgers.alice.address,
          issuedAt,
          nonce: nextNonce(),
        }),
      });
    expect((await enrollAs("Alice Dupont", nowSec(h))).json.error.code).toBe("INVALID_REQUEST");
    expect((await enrollAs("Alice Martin", nowSec(h) - 11n * 60n)).json.error.code).toBe("STALE");
  });

  it("refuses a replayed enrollment (nonce already used)", async () => {
    const body = await signedWire(ledgers.alice, "EmployeeEnroll", {
      company: "Acme",
      employeeName: "Alice Martin",
      team: "Ventes",
      enclaveMeasurement: MEASUREMENT,
      employee: ledgers.alice.address,
      issuedAt: nowSec(h),
      nonce: 42n,
    });
    expect((await call(h, "POST", "/v1/enroll", { body })).status).toBe(201);
    const replay = await call(h, "POST", "/v1/enroll", { body });
    expect(replay.status).toBe(409);
    expect(replay.json.error.code).toBe("NONCE_REUSED");
  });

  it("caps sessions at 12 hours and refuses a Ledger address as session key", async () => {
    await onboard(h, "alice");
    const session = async (expiresIn: bigint, sessionKey: Hex) =>
      call(h, "POST", "/v1/sessions", {
        body: await signedWire(ledgers.alice, "AgentSession", {
          agentName: "Agent",
          access: "Demandes",
          expiresAt: nowSec(h) + expiresIn,
          sessionKey,
          enclaveMeasurement: MEASUREMENT,
          employee: ledgers.alice.address,
          nonce: nextNonce(),
        }),
      });
    expect((await session(13n * 3600n, agents.bob.address)).json.error.code).toBe("SESSION_TOO_LONG");
    expect((await session(3600n, ledgers.bob.address)).json.error.code).toBe("INVALID_REQUEST");
    expect((await session(3600n, agents.alice.address)).json.error.code).toBe("ALREADY_EXISTS");
  });

  it("forgets a session once it expires", async () => {
    await onboard(h, "alice");
    h.clock.advance(9 * 3600 * 1000);
    expect((await call(h, "GET", "/v1/me", { as: "alice" })).status).toBe(401);
  });
});

describe("one-off consents", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
    await onboard(h, "alice", "bob");
  });

  it("refuses an approval once the request has expired", async () => {
    await orionTask(h);
    const [share] = await pendingShares(h, "bob");
    if (!share) throw new Error("no share");
    const signature = await signTyped(ledgers.bob, "ContextShare", share.message);
    h.clock.advance(DAY_MS + 1000);
    await refreshSessions(h, "alice", "bob");
    const response = await call(h, "POST", `/v1/consents/${share.id}/approve`, {
      as: "bob",
      body: { signature },
    });
    expect(response.json.error.code).toBe("EXPIRED");
    // Listing the owner's requests retires expired ones; the task no longer waits for them.
    expect(await pendingShares(h, "bob")).toHaveLength(0);
  });

  it("refuses a consent whose signed excerpt hash does not match the stored excerpt", async () => {
    await orionTask(h);
    const [share] = await pendingShares(h, "bob");
    if (!share) throw new Error("no share");
    // A tampered request record: the owner would sign a hash that is not the excerpt about to be released.
    const tampered = { ...share.message, excerptHash: `0x${"ee".repeat(32)}` as Hex };
    h.services.ctx.db
      .prepare("UPDATE consent_requests SET message = ? WHERE id = ?")
      .run(JSON.stringify(encodeBadgeMessage("ContextShare", tampered)), share.id);
    const signature = await signTyped(ledgers.bob, "ContextShare", tampered);
    const response = await call(h, "POST", `/v1/consents/${share.id}/approve`, {
      as: "bob",
      body: { signature },
    });
    expect(response.status).toBe(422);
    expect(response.json.error.code).toBe("EXCERPT_HASH_MISMATCH");
  });

  it("refuses a request decided by someone else than the owner", async () => {
    await orionTask(h);
    const [share] = await pendingShares(h, "bob");
    if (!share) throw new Error("no share");
    const signature = await signTyped(ledgers.bob, "ContextShare", share.message);
    const response = await call(h, "POST", `/v1/consents/${share.id}/approve`, {
      as: "alice",
      body: { signature },
    });
    expect(response.json.error.code).toBe("NOT_FOUND");
  });

  it("does not reuse a grant revoked by id, and refuses revoking someone else's grant", async () => {
    await orionTask(h);
    const [share] = await pendingShares(h, "bob");
    if (!share) throw new Error("no share");
    const signature = await signTyped(ledgers.bob, "ContextShare", share.message);
    const { grantId } = (
      await call(h, "POST", `/v1/consents/${share.id}/approve`, { as: "bob", body: { signature } })
    ).json;
    expect((await orionTask(h)).allowed.some((e: { basis: string }) => e.basis === "grant")).toBe(true);

    const revokeBody = async (owner: typeof ledgers.bob, id: Hex) =>
      signedWire(owner, "ContextRevoke", {
        targetLabel: "Partage Orion",
        issuedAt: nowSec(h),
        grantId: id,
        recipient: ledgers.alice.address,
        owner: owner.address,
        nonce: nextNonce(),
      });
    const foreign = await call(h, "POST", "/v1/revocations", {
      as: "alice",
      body: await revokeBody(ledgers.alice, grantId),
    });
    expect(foreign.json.error.code).toBe("NOT_FOUND");
    const notMine = await call(h, "POST", "/v1/revocations", {
      as: "alice",
      body: await revokeBody(ledgers.bob, grantId),
    });
    expect(notMine.json.error.code).toBe("FORBIDDEN");

    const revoked = await call(h, "POST", "/v1/revocations", {
      as: "bob",
      body: await revokeBody(ledgers.bob, grantId),
    });
    expect(revoked.json.grantsRevoked).toBe(1);
    const next = await orionTask(h);
    expect(next.allowed.some((e: { basis: string }) => e.basis === "grant")).toBe(false);
    expect(next.status).toBe("waiting_consent");
  });

  it("refuses a revocation of everything without a directory recipient", async () => {
    const response = await call(h, "POST", "/v1/revocations", {
      as: "bob",
      body: await signedWire(ledgers.bob, "ContextRevoke", {
        targetLabel: "Tout",
        issuedAt: nowSec(h),
        grantId: zeroHash,
        recipient: agents.alice.address,
        owner: ledgers.bob.address,
        nonce: nextNonce(),
      }),
    });
    expect(response.json.error.code).toBe("INVALID_REQUEST");
    expect(h.keyRotator.rotated).toEqual([]);
  });
});

describe("standing policies", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
    await onboard(h, "alice", "bob");
  });

  const policyBases = async () =>
    (await orionTask(h)).allowed.filter((e: { basis: string }) => e.basis === "policy").length;

  it("refuses a policy pinned to another enclave, signed by another key, or posted by someone else", async () => {
    expect((await postPolicy(h, policy(h, { enclaveMeasurement: OTHER_MEASUREMENT }))).json.error.code).toBe(
      "ENCLAVE_MISMATCH",
    );
    expect((await postPolicy(h, policy(h), ledgers.alice)).json.error.code).toBe("SIGNATURE_MISMATCH");
    expect((await postPolicy(h, policy(h), ledgers.bob, "alice")).json.error.code).toBe("FORBIDDEN");
    expect((await postPolicy(h, policy(h, { granteeTeam: "Marketing" }))).json.error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("refuses a replayed policy", async () => {
    const message = policy(h);
    expect((await postPolicy(h, message)).status).toBe(201);
    expect((await postPolicy(h, message)).json.error.code).toBe("NONCE_REUSED");
  });

  it("does not cover another team, another tag, or longer excerpts", async () => {
    await postPolicy(h, policy(h, { granteeTeam: toDeviceAscii("Juridique & conformité") }));
    await postPolicy(h, policy(h, { contextTag: "perso" }));
    await postPolicy(h, policy(h, { maxExcerptLength: 100 }));
    expect(await policyBases()).toBe(0);
  });

  it("stops covering once expired or revoked", async () => {
    const created = (await postPolicy(h, policy(h, { expiresAt: nowSec(h) + 2n * 24n * 3600n }))).json;
    expect(await policyBases()).toBe(3);
    h.clock.advance(3 * DAY_MS);
    await refreshSessions(h, "alice", "bob");
    expect(await policyBases()).toBe(0);

    const second = (await postPolicy(h, policy(h))).json;
    expect(await policyBases()).toBe(3);
    const revoke = await call(h, "POST", "/v1/revocations", {
      as: "bob",
      body: await signedWire(ledgers.bob, "ContextRevoke", {
        targetLabel: "Accord Ventes",
        issuedAt: nowSec(h),
        grantId: second.policyId,
        recipient: ledgers.alice.address,
        owner: ledgers.bob.address,
        nonce: nextNonce(),
      }),
    });
    expect(revoke.json.policiesRevoked).toBe(1);
    expect(await policyBases()).toBe(0);
    const listed = (await call(h, "GET", "/v1/policies", { as: "bob" })).json.policies;
    expect(listed.map((p: { id: string; active: boolean }) => [p.id, p.active])).toEqual([
      [created.policyId, false],
      [second.policyId, false],
    ]);
  });
});
