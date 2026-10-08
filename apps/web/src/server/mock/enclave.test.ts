/**
 * Demo scenario against the mock enclave, with the PUBLIC Speculos test mnemonics standing in for the devices
 * (same addresses as the demo Ledgers, see infra/speculos.sh): every signature is a real EIP-712 signature.
 */
import { existsSync } from "node:fs";
import {
  complianceKeyDeriveMessage,
  complianceKeyFromSignature,
  complianceKeyRegistrationMessage,
  openSealed,
} from "@badge/attest";
import { fileURLToPath } from "node:url";
import {
  badgeTypedData,
  decodeBadgeMessage,
  deskIdentityDeriveMessage,
  toUnixSeconds,
  type BadgeMessageKind,
  type BadgeMessages,
  type SignedMessage,
} from "@badge/consent";
import { buildDeskGroup, createDeskProof, deriveDeskIdentity, encodeDeskProof } from "@badge/zk";
import type { TypedDataDefinition } from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { EnclaveError } from "../errors";
import { buildAgentSession, buildContextPolicy, buildDeskJoin, buildEmployeeEnroll } from "../messages";
import { MockEnclave } from "./enclave";

const TEST_MNEMONICS: Readonly<Record<EmployeeId, string>> = {
  alice: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  bob: "legal winner thank year wave sausage worth useful legal winner thank yellow",
  chloe: "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
};
const ACCOUNTS = Object.fromEntries(
  Object.entries(TEST_MNEMONICS).map(([id, mnemonic]) => [id, mnemonicToAccount(mnemonic)]),
) as Record<EmployeeId, HDAccount>;
const ORION_TASK = {
  task: "Prepare the brief for tomorrow's meeting with client Orion",
  taskLabel: "Orion brief",
};
const ZK_ARTIFACTS = fileURLToPath(
  new URL("../../../../../infra/zk-artifacts/semaphore-16.zkey", import.meta.url),
);
const zkArtifactsAvailable = existsSync(ZK_ARTIFACTS) || process.env.BADGE_ZK_ARTIFACTS_DIR !== undefined;

async function sign<K extends BadgeMessageKind>(
  employee: EmployeeId,
  kind: K,
  message: BadgeMessages[K],
): Promise<SignedMessage<K>> {
  // Same payload as the Ledger signs (badgeTypedData); the cast only bridges viem's generic signature.
  const signature = await ACCOUNTS[employee].signTypedData(
    badgeTypedData(kind, message) as unknown as TypedDataDefinition,
  );
  return { kind, message, signature };
}

const now = (): bigint => toUnixSeconds(new Date());

let enclave: MockEnclave;
let measurement: `0x${string}`;

beforeEach(async () => {
  enclave = new MockEnclave();
  measurement = (await enclave.attestation()).measurement;
});

describe("mock enclave demo scenario", () => {
  it("uses the demo Ledger addresses for the test mnemonics", () => {
    for (const id of Object.keys(ACCOUNTS) as EmployeeId[]) {
      expect(ACCOUNTS[id].address).toBe(EMPLOYEES[id].address);
    }
  });

  it("enrolls, then delegates to an agent, and refuses a replayed enrollment", async () => {
    const enroll = await sign(
      "alice",
      "EmployeeEnroll",
      buildEmployeeEnroll(EMPLOYEES.alice, measurement, now()),
    );
    expect((await enclave.enroll(enroll)).enrolled).toBe(true);
    await expect(enclave.enroll(enroll)).rejects.toMatchObject({ code: "CONFLICT" });

    const { message, sessionKey } = buildAgentSession(EMPLOYEES.alice, measurement);
    const session = await sign("alice", "AgentSession", message);
    expect((await enclave.openSession("alice", session)).session?.sessionKey).toBe(sessionKey.address);
  });

  it("waits for Bob's Ledger consent, then drafts the brief with it", async () => {
    const task = await enclave.createTask("alice", ORION_TASK);
    expect(task.status).toBe("waiting_consent");
    expect(task.allowed.map((s) => s.allowedBy)).toEqual(expect.arrayContaining(["global", "own"]));
    expect(task.blocked.map((b) => b.kind)).toContain("classifier");

    const [request] = await enclave.listConsents("bob");
    if (request === undefined) throw new Error("expected a consent request for Bob");
    expect(request.findings).toEqual([]);
    const message = decodeBadgeMessage("ContextShare", request.message);
    expect(message.recipientName).toBe("Alice Martin (Sales)");

    // A signature by someone else than the owner is refused.
    const forged = await sign("alice", "ContextShare", message);
    await expect(enclave.approveConsent("bob", request.id, forged.signature)).rejects.toMatchObject({
      code: "SIGNATURE_MISMATCH",
    });

    const signed = await sign("bob", "ContextShare", message);
    await enclave.approveConsent("bob", request.id, signed.signature);
    const ready = await enclave.getTask("alice", task.id);
    expect(ready.status).toBe("ready");
    expect(ready.allowed.some((s) => s.allowedBy === "consent" && s.owner === "bob")).toBe(true);
    expect(ready.brief?.recommendation).toContain("AX-500");
    expect(ready.tokenStats?.selectedTokens).toBeLessThan(ready.tokenStats?.allContextTokens ?? 0);

    // The same excerpt for the same recipient is reused until revoked.
    const again = await enclave.createTask("alice", ORION_TASK);
    expect(again.status).toBe("ready");
    expect(again.allowed.some((s) => s.allowedBy === "grant")).toBe(true);

    const [grant] = await enclave.listGrants("bob");
    if (grant === undefined) throw new Error("expected a grant");
    const revoke = await enclave.prepareRevocation("bob", { grantId: grant.id });
    expect(revoke.targetLabel).toMatch(/^Alice Martin \(Sales\) - /);
    expect(await enclave.revoke("bob", await sign("bob", "ContextRevoke", revoke))).toEqual({ revoked: 1 });
    expect((await enclave.createTask("alice", ORION_TASK)).status).toBe("waiting_consent");
  });

  it("flags the compromised agent to Bob and the compliance log, and refuses when Bob refuses", async () => {
    const task = await enclave.createTask("alice", {
      task: "notes",
      taskLabel: "notes",
      trap: { requestFullContextOf: "bob" },
    });
    expect(task.pending[0]?.findings.map((f) => f.rule)).toEqual(
      expect.arrayContaining(["full-context", "owner-share"]),
    );
    const [request] = await enclave.listConsents("bob");
    if (request === undefined) throw new Error("expected a flagged request");
    await enclave.rejectConsent("bob", request.id);
    expect((await enclave.getTask("alice", task.id)).status).toBe("refused");
    expect(await enclave.listConsents("bob")).toEqual([]);
    const [decided] = await enclave.consentHistory("bob");
    expect(decided).toEqual({
      id: request.id,
      requester: "alice",
      excerptLabel: request.message.excerptLabel,
      flagged: true,
      status: "rejected",
      createdAt: request.createdAt,
    });

    const audit = await enclave.audit("chloe");
    expect(audit.chain.ok).toBe(true);
    expect(audit.alerts.map((a) => a.level)).toContain("warn");
    await expect(enclave.audit("alice")).rejects.toBeInstanceOf(EnclaveError);
  });

  it("applies Bob's standing agreement instead of asking him again", async () => {
    const policy = buildContextPolicy(
      EMPLOYEES.bob,
      {
        granteeTeam: "Sales",
        contextTag: "terms",
        purpose: "client briefs",
        maxExcerptLength: 800,
        durationDays: 30,
      },
      measurement,
      now(),
    );
    await enclave.createPolicy("bob", await sign("bob", "ContextPolicy", policy));
    const task = await enclave.createTask("alice", ORION_TASK);
    expect(task.allowed.find((s) => s.allowedBy === "policy")?.label).toBe("Orion 2025 terms");
    expect((await enclave.listPolicies("bob"))[0]?.uses).toBe(1);
  });

  it.skipIf(!zkArtifactsAvailable)(
    "delivers a desk share with a verified ZK proof and seals the sharer",
    async () => {
      // Desk shares are sealed to the compliance key: Chloe registers hers first, derived from her "Ledger".
      const { secretKey, publicKey } = complianceKeyFromSignature(
        await ACCOUNTS.chloe.signMessage({ message: complianceKeyDeriveMessage("Acme") }),
      );
      const publicKeyHex = Buffer.from(publicKey).toString("hex");
      await enclave.registerComplianceKey("chloe", {
        publicKey: publicKeyHex,
        signature: await ACCOUNTS.chloe.signMessage({
          message: complianceKeyRegistrationMessage("Acme", publicKeyHex),
        }),
      });

      const derivation = await ACCOUNTS.bob.signMessage({ message: deskIdentityDeriveMessage("Acme") });
      const identity = deriveDeskIdentity(derivation);
      await enclave.joinDesk(
        "bob",
        await sign("bob", "DeskJoin", buildDeskJoin(EMPLOYEES.bob, "Research", identity.commitment)),
      );

      await enclave.createDeskRequest("alice", {
        fromDesk: "origination",
        toDesk: "research",
        task: "Industrial sensor market trends and component prices",
      });
      const [request] = (await enclave.listDeskRequests("bob")).incoming;
      if (request === undefined) throw new Error("expected a desk request for Bob");
      const message = decodeBadgeMessage("DeskShare", request.message);
      const desk = (await enclave.listDesks("bob")).find((d) => d.id === "research");
      if (desk === undefined) throw new Error("research desk missing");
      const proof = await createDeskProof({
        identity,
        group: buildDeskGroup(desk.commitments.map((c) => BigInt(c))),
        excerptHash: message.excerptHash,
        requestId: message.requestId,
      });
      await enclave.approveDeskRequest(
        "bob",
        request.id,
        await sign("bob", "DeskShare", message),
        encodeDeskProof(proof),
      );

      const [delivered] = (await enclave.listDeskRequests("alice")).outgoing;
      expect(delivered?.delivery?.sourceDesk).toBe("research");
      const audit = await enclave.audit("chloe");
      const share = audit.entries.find((e) => e.type === "desk.share");
      expect(share?.actor).toBe("desk:research");
      expect(JSON.stringify(share)).not.toContain(EMPLOYEES.bob.address);
      const signer = JSON.parse(new TextDecoder().decode(openSealed(secretKey, share?.data["sealedSigner"])));
      expect(signer).toMatchObject({ employeeId: "bob", address: EMPLOYEES.bob.address });
      const revealed = await enclave.revealNotice("chloe", {
        seq: share?.seq ?? 0,
        reason: "test",
        signer: "bob",
      });
      expect(revealed.revealed?.employee).toBe("bob");
    },
  );
});
