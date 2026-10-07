import { describe, expect, it } from "vitest";
import { buildDeskGroup, deriveDeskIdentity, deskGroupRoot, InMemoryNullifierRegistry } from "../src";
import { ledgerSignatureOf } from "./fixtures";

describe("deriveDeskIdentity", () => {
  it("re-derives the same identity from the same Ledger signature", async () => {
    const first = deriveDeskIdentity(await ledgerSignatureOf("alice"));
    const second = deriveDeskIdentity(await ledgerSignatureOf("alice"));
    expect(second.commitment).toBe(first.commitment);
  });

  it("gives different signers different identities", async () => {
    const alice = deriveDeskIdentity(await ledgerSignatureOf("alice"));
    const bob = deriveDeskIdentity(await ledgerSignatureOf("bob"));
    expect(bob.commitment).not.toBe(alice.commitment);
  });

  it("rejects anything that is not a 65-byte signature", () => {
    expect(() => deriveDeskIdentity("0x1234")).toThrow(
      expect.objectContaining({ code: "INVALID_SIGNATURE" }),
    );
    expect(() => deriveDeskIdentity(`0x${"zz".repeat(65)}`)).toThrow(
      expect.objectContaining({ code: "INVALID_SIGNATURE" }),
    );
  });
});

describe("buildDeskGroup", () => {
  it("contains its members and has a stable root", async () => {
    const commitments = await Promise.all(
      ["alice", "bob", "chloe"].map(
        async (name) => deriveDeskIdentity(await ledgerSignatureOf(name)).commitment,
      ),
    );
    const group = buildDeskGroup(commitments);
    expect(group.size).toBe(3);
    expect(group.indexOf(commitments[1] ?? 0n)).toBe(1);
    expect(deskGroupRoot(commitments)).toBe(group.root);
  });

  it.each([
    ["an empty list", []],
    ["a duplicate", [1n, 1n]],
    ["zero", [0n]],
    ["a value outside the field", [2n ** 254n]],
  ])("rejects %s", (_label, commitments) => {
    expect(() => buildDeskGroup(commitments)).toThrow(expect.objectContaining({ code: "INVALID_GROUP" }));
  });
});

describe("InMemoryNullifierRegistry", () => {
  it("accepts a nullifier once per scope", async () => {
    const registry = new InMemoryNullifierRegistry();
    expect(await registry.consume(1n, 7n)).toBe(true);
    expect(await registry.consume(1n, 7n)).toBe(false);
    expect(await registry.consume(2n, 7n)).toBe(true);
  });
});
