/**
 * DEMO FIXTURES ONLY. The Research desk has a single demo Ledger holder (Bob); a Semaphore group of one is not
 * anonymous at all (the proof reveals "the only member shared"). The dataset therefore lists directory-only
 * employees (David, Emma) whose desk identities are registered here at boot so the anonymity set is >= 3.
 *
 * Their identities are derived exactly like a real one (`deriveDeskIdentity` of an EIP-191 signature of
 * `deskIdentityDeriveMessage`), but the signature comes from a software key computed from a public seed in the
 * dataset: anyone can recompute it. They have no Ledger address, so they can never sign a DeskShare and their
 * membership can only pad the anonymity set; in a real deployment every member joins with their own Ledger.
 */
import { deskIdentityDeriveMessage } from "@badge/consent";
import { deriveDeskIdentity } from "@badge/zk";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Directory } from "../directory";
import type { DeskService } from "./service";

/** The identity commitment of a fixture, from its public seed. */
export async function fixtureCommitment(seed: string, company: string): Promise<bigint> {
  const account = privateKeyToAccount(keccak256(stringToHex(seed)));
  const signature = await account.signMessage({ message: deskIdentityDeriveMessage(company) });
  return deriveDeskIdentity(signature).commitment;
}

/** Registers every fixture's commitment in each of its desks (idempotent; call at boot). */
export async function registerDeskFixtures(desks: DeskService, directory: Directory): Promise<void> {
  for (const fixture of directory.deskFixtures()) {
    if (fixture.deskIdentityFixtureSeed === undefined) continue;
    const commitment = await fixtureCommitment(fixture.deskIdentityFixtureSeed, directory.company.name);
    for (const deskId of fixture.desks) desks.registerFixture(deskId, fixture.id, commitment);
  }
}
