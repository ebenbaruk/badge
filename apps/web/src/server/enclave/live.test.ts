import { hashExcerpt } from "@badge/consent";
import { buildDeskGroup, createDeskProof, deriveDeskIdentity, encodeDeskProof } from "@badge/zk";
import { keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { verifyDeskDelivery } from "./live";

const REQUEST_ID: Hex = `0x${"0a".repeat(32)}`;
const EXCERPT = "Le marche europeen des capteurs croit de 8 % par an.";

async function identity(name: string) {
  const account = privateKeyToAccount(keccak256(stringToHex(`badge-web-test:${name}`)));
  return deriveDeskIdentity(await account.signMessage({ message: "desk identity" }));
}

describe("verifyDeskDelivery (requester side)", () => {
  it("binds the delivered text and checks the proof against the snapshotted root only", async () => {
    const [bob, david, emma] = await Promise.all(["bob", "david", "emma"].map(identity));
    if (!bob || !david || !emma) throw new Error("identities");
    const group = buildDeskGroup([david.commitment, emma.commitment, bob.commitment]);
    const excerptHash = hashExcerpt(EXCERPT) as Hex;
    const proof = encodeDeskProof(
      await createDeskProof({ identity: bob, group, excerptHash, requestId: REQUEST_ID }),
    );
    const snapshot = group.root.toString();
    const delivery = { excerpt: EXCERPT, excerptHash, proof };

    expect(await verifyDeskDelivery(REQUEST_ID, snapshot, delivery)).toBe(true);
    // A text the proof and the DeskShare signature do not cover is never shown as verified.
    expect(
      await verifyDeskDelivery(REQUEST_ID, snapshot, { ...delivery, excerpt: `${EXCERPT} (modifie)` }),
    ).toBe(false);
    // The desk's current root after a later join is not the one the proof was made against.
    const later = buildDeskGroup([david.commitment, emma.commitment, bob.commitment, 42n]).root.toString();
    expect(await verifyDeskDelivery(REQUEST_ID, later, delivery)).toBe(false);
    expect(await verifyDeskDelivery(REQUEST_ID, null, delivery)).toBe(false);
  }, 60_000);
});
