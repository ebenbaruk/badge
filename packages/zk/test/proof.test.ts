import { verifyProof } from "@semaphore-protocol/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildDeskGroup,
  createDeskProof,
  decodeDeskProof,
  deriveDeskIdentity,
  type DeskProof,
  encodeDeskProof,
  type Group,
  type Identity,
  InMemoryNullifierRegistry,
  verifyDeskProof,
  type ZkErrorCode,
} from "../src";
import {
  EXCERPT_HASH,
  ledgerSignatureOf,
  OTHER_EXCERPT_HASH,
  OTHER_REQUEST_ID,
  REQUEST_ID,
} from "./fixtures";

function rejectsWith(code: ZkErrorCode) {
  return expect.objectContaining({ name: "ZkError", code });
}

async function identityOf(name: string): Promise<Identity> {
  return deriveDeskIdentity(await ledgerSignatureOf(name));
}

let alice: Identity;
let mallory: Identity;
let deskA: Group;
let deskB: Group;
let aliceProof: DeskProof;

const expectationsForDeskA = () => ({
  expectedRoot: deskA.root,
  expectedExcerptHash: EXCERPT_HASH,
  expectedRequestId: REQUEST_ID,
});

beforeAll(async () => {
  const [a, a1, a2, m, b2, b3] = await Promise.all(
    ["alice", "a1", "a2", "mallory", "b2", "b3"].map((name) => identityOf(name)),
  );
  if (!a || !a1 || !a2 || !m || !b2 || !b3) throw new Error("fixture identities missing");
  alice = a;
  mallory = m;
  deskA = buildDeskGroup([a.commitment, a1.commitment, a2.commitment]);
  deskB = buildDeskGroup([m.commitment, b2.commitment, b3.commitment]);
  aliceProof = await createDeskProof({
    identity: alice,
    group: deskA,
    excerptHash: EXCERPT_HASH,
    requestId: REQUEST_ID,
  });
});

describe("createDeskProof", () => {
  it("always proves at depth 16, whatever the group size", () => {
    expect(deskA.depth).toBeLessThan(16);
    expect(aliceProof.merkleTreeDepth).toBe(16);
  });

  it("carries the raw excerpt hash and request id as message and scope", () => {
    expect(BigInt(aliceProof.message)).toBe(BigInt(EXCERPT_HASH));
    expect(BigInt(aliceProof.scope)).toBe(BigInt(REQUEST_ID));
  });

  it("refuses an identity outside the group", async () => {
    await expect(
      createDeskProof({ identity: mallory, group: deskA, excerptHash: EXCERPT_HASH, requestId: REQUEST_ID }),
    ).rejects.toEqual(rejectsWith("NOT_A_MEMBER"));
  });

  it("refuses a non-bytes32 excerpt hash", async () => {
    await expect(
      createDeskProof({ identity: alice, group: deskA, excerptHash: "0x01", requestId: REQUEST_ID }),
    ).rejects.toEqual(rejectsWith("INVALID_INPUT"));
  });

  it("fails closed when the artifacts are missing", async () => {
    await expect(
      createDeskProof({
        identity: alice,
        group: deskA,
        excerptHash: EXCERPT_HASH,
        requestId: REQUEST_ID,
        artifactsDir: "/nonexistent/zk-artifacts",
      }),
    ).rejects.toEqual(rejectsWith("ARTIFACTS_MISSING"));
  });
});

describe("verifyDeskProof", () => {
  it("accepts a valid proof sent over the wire and returns its nullifier", async () => {
    const received = decodeDeskProof(JSON.parse(JSON.stringify(encodeDeskProof(aliceProof))));
    const result = await verifyDeskProof(received, expectationsForDeskA(), new InMemoryNullifierRegistry());
    expect(result.nullifier).toBe(BigInt(aliceProof.nullifier));
  });

  it("rejects a valid proof from another desk's group (verifyProof alone would accept it)", async () => {
    const malloryProof = await createDeskProof({
      identity: mallory,
      group: deskB,
      excerptHash: EXCERPT_HASH,
      requestId: REQUEST_ID,
    });
    expect(await verifyProof(malloryProof)).toBe(true);
    await expect(
      verifyDeskProof(malloryProof, expectationsForDeskA(), new InMemoryNullifierRegistry()),
    ).rejects.toEqual(rejectsWith("WRONG_ROOT"));
  });

  it("rejects a proof for another excerpt", async () => {
    await expect(
      verifyDeskProof(
        aliceProof,
        { ...expectationsForDeskA(), expectedExcerptHash: OTHER_EXCERPT_HASH },
        new InMemoryNullifierRegistry(),
      ),
    ).rejects.toEqual(rejectsWith("WRONG_MESSAGE"));
  });

  it("rejects a proof for another request", async () => {
    await expect(
      verifyDeskProof(
        aliceProof,
        { ...expectationsForDeskA(), expectedRequestId: OTHER_REQUEST_ID },
        new InMemoryNullifierRegistry(),
      ),
    ).rejects.toEqual(rejectsWith("WRONG_SCOPE"));
  });

  it("rejects a proof whose message was swapped to match the expectation", async () => {
    const tampered: DeskProof = { ...aliceProof, message: BigInt(OTHER_EXCERPT_HASH).toString() };
    await expect(
      verifyDeskProof(
        tampered,
        { ...expectationsForDeskA(), expectedExcerptHash: OTHER_EXCERPT_HASH },
        new InMemoryNullifierRegistry(),
      ),
    ).rejects.toEqual(rejectsWith("INVALID_PROOF"));
  });

  it("rejects a proof that does not claim depth 16", async () => {
    const tampered: DeskProof = { ...aliceProof, merkleTreeDepth: 2 };
    await expect(
      verifyDeskProof(tampered, expectationsForDeskA(), new InMemoryNullifierRegistry()),
    ).rejects.toEqual(rejectsWith("WRONG_DEPTH"));
  });

  it("rejects a malformed proof", async () => {
    const tampered = { ...aliceProof, nullifier: "0x01" } as unknown as DeskProof;
    await expect(
      verifyDeskProof(tampered, expectationsForDeskA(), new InMemoryNullifierRegistry()),
    ).rejects.toEqual(rejectsWith("MALFORMED_PROOF"));
  });

  it("rejects a second share by the same member for the same request, even with a fresh proof", async () => {
    const registry = new InMemoryNullifierRegistry();
    await verifyDeskProof(aliceProof, expectationsForDeskA(), registry);
    await expect(verifyDeskProof(aliceProof, expectationsForDeskA(), registry)).rejects.toEqual(
      rejectsWith("NULLIFIER_REUSED"),
    );
    const fresh = await createDeskProof({
      identity: alice,
      group: deskA,
      excerptHash: EXCERPT_HASH,
      requestId: REQUEST_ID,
    });
    await expect(verifyDeskProof(fresh, expectationsForDeskA(), registry)).rejects.toEqual(
      rejectsWith("NULLIFIER_REUSED"),
    );
  });

  it("does not burn the nullifier when a proof is rejected", async () => {
    const registry = new InMemoryNullifierRegistry();
    const tampered: DeskProof = { ...aliceProof, message: BigInt(OTHER_EXCERPT_HASH).toString() };
    await expect(
      verifyDeskProof(
        tampered,
        { ...expectationsForDeskA(), expectedExcerptHash: OTHER_EXCERPT_HASH },
        registry,
      ),
    ).rejects.toEqual(rejectsWith("INVALID_PROOF"));
    await expect(verifyDeskProof(aliceProof, expectationsForDeskA(), registry)).resolves.toBeDefined();
  });

  it("gives the same member an unlinkable nullifier per request", async () => {
    const otherRequestProof = await createDeskProof({
      identity: alice,
      group: deskA,
      excerptHash: EXCERPT_HASH,
      requestId: OTHER_REQUEST_ID,
    });
    expect(otherRequestProof.nullifier).not.toBe(aliceProof.nullifier);
    const registry = new InMemoryNullifierRegistry();
    await verifyDeskProof(aliceProof, expectationsForDeskA(), registry);
    await expect(
      verifyDeskProof(
        otherRequestProof,
        { ...expectationsForDeskA(), expectedRequestId: OTHER_REQUEST_ID },
        registry,
      ),
    ).resolves.toBeDefined();
  });
});

describe("decodeDeskProof", () => {
  it.each([
    ["a hex number", { nullifier: "0x01" }],
    ["a non-numeric string", { merkleTreeRoot: "x" }],
    ["a leading zero", { scope: "007" }],
    ["a value above 2^256", { message: (2n ** 256n).toString() }],
    ["an extra field", { signer: "alice" }],
    ["a truncated proof", { points: ["1", "2"] }],
  ])("rejects %s", (_label, override) => {
    expect(() => decodeDeskProof({ ...encodeDeskProof(aliceProof), ...override })).toThrow(
      rejectsWith("MALFORMED_PROOF"),
    );
  });
});
