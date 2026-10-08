import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSeedDataset, SeedDatasetError } from "./seed-dataset";

describe("acme demo dataset", () => {
  const dataset = loadSeedDataset();

  it("has the five demo employees, with Alice's Ledger address", () => {
    expect(dataset.employees.map((e) => e.id)).toEqual(["alice", "bob", "chloe", "david", "emma"]);
    expect(dataset.employees[0]?.ledgerAddress).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  });

  it("contains Bob's Orion terms note verbatim", () => {
    const note = dataset.notes.find((n) => n.id === "bob-orion-conditions-2025");
    expect(note?.ownerId).toBe("bob");
    expect(note?.text).toContain("12% discount if volume > 40k units, payment at 60 days end of month");
  });

  it("keeps Chloe's sensitive HR note off the Orion topic", () => {
    const note = dataset.notes.find((n) => n.id === "chloe-rh-prudhommes");
    expect(note?.ownerId).toBe("chloe");
    expect(note?.text.toLowerCase()).not.toContain("orion");
  });

  it("rejects a dataset with an unknown note owner", () => {
    const dir = mkdtempSync(join(tmpdir(), "badge-seed-"));
    const file = join(dir, "bad.json");
    writeFileSync(
      file,
      JSON.stringify({ ...dataset, notes: [{ id: "x", ownerId: "mallory", text: "t", tags: [] }] }),
    );
    expect(() => loadSeedDataset(file)).toThrow(SeedDatasetError);
  });
});
