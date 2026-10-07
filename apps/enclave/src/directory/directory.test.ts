import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACME_DATASET_PATH } from "../memory/seed-dataset";
import { Directory, DirectoryError, loadDirectory } from "./directory";
import { ContextInventory } from "./inventory";

const raw = () => JSON.parse(readFileSync(ACME_DATASET_PATH, "utf8")) as Record<string, unknown>;

describe("demo directory", () => {
  const directory = loadDirectory();

  it("has five Ledger holders, Chloe as compliance, and no identity without a Ledger", () => {
    expect(directory.employees().map((e) => e.id)).toEqual(["alice", "bob", "chloe", "david", "emma"]);
    expect(directory.employee("chloe")?.role).toBe("compliance");
    // David and Emma join the Research desk with their own Ledger: no desk identity has a public secret.
    expect(directory.employees().every((e) => e.address !== null)).toBe(true);
  });

  it("puts Bob, David and Emma on the Research desk (anonymity set of 3)", () => {
    expect(directory.desk("research")?.memberIds).toEqual(["bob", "david", "emma"]);
    expect(directory.isDeskMember("alice", "origination")).toBe(true);
    expect(directory.isDeskMember("alice", "research")).toBe(false);
  });

  it("names employees as the device shows them and resolves Ledger addresses", () => {
    const alice = directory.requireEmployee("alice");
    expect(directory.displayName(alice)).toBe("Alice Martin (Ventes)");
    expect(directory.byAddress("0x9858effd232b4033e47d90003d41ec34ecaeda94")?.id).toBe("alice");
    expect(directory.deskByName("Research")?.id).toBe("research");
  });

  it("exposes the exchange rule from Research to Origination", () => {
    expect(directory.rulesForRecipient("origination")).toEqual([
      {
        id: "rule-4",
        label: "Regle 4 - marche capteurs",
        sourceDesk: "research",
        recipientDesk: "origination",
        allowedTags: ["marche-capteurs", "prix-composants"],
      },
    ]);
  });

  it("rejects rules on unknown desks and duplicate Ledger addresses", () => {
    expect(() =>
      Directory.fromSeed({
        ...raw(),
        exchangeRules: [
          { id: "r", label: "R", sourceDesk: "nowhere", recipientDesk: "research", allowedTags: ["x"] },
        ],
      }),
    ).toThrow(DirectoryError);
    const data = raw() as { employees: Array<{ ledgerAddress: string }> };
    const [first, second] = data.employees;
    if (!first || !second) throw new Error("dataset too small");
    second.ledgerAddress = first.ledgerAddress;
    expect(() => Directory.fromSeed(data)).toThrow(DirectoryError);
  });
});

describe("context inventory", () => {
  it("measures each owner's whole context", () => {
    const inventory = new ContextInventory([
      { id: "a", ownerId: "bob", text: "abc", tags: [] },
      { id: "b", ownerId: "bob", text: "été", tags: [] },
      { id: "c", ownerId: "company", text: "x", tags: [] },
    ]);
    expect(inventory.totalLength("bob")).toBe(6);
    expect(inventory.totalLength("nobody")).toBe(0);
    expect(inventory.personalOwners()).toEqual(["bob"]);
    expect(inventory.allNotes()).toHaveLength(3);
  });
});
