import { describe, expect, it } from "vitest";
import { findCandidates, isExcludedPersonalData, tokenize } from "./retrieval";
import { loadSeed } from "./seed";

const { notes } = loadSeed();
const ORION_TASK = "Prépare-moi le brief du rendez-vous de demain avec le client Orion";

describe("mock retrieval", () => {
  it("tokenizes without accents, stopwords or plural s", () => {
    expect([...tokenize("Prépare les capteurs d'Orion")]).toEqual(["capteur", "orion"]);
  });

  it("recalls the notes of the seed recall check and never the HR file", () => {
    const ids = findCandidates(ORION_TASK, notes).map((c) => c.note.id);
    expect(ids).toEqual(expect.arrayContaining(["bob-orion-conditions-2025", "alice-objectif-orion"]));
    expect(ids).not.toContain("chloe-rh-prudhommes");
  });

  it("excludes someone else's personal data but keeps the requester's own", () => {
    const leave = notes.find((n) => n.id === "bob-perso-conges");
    if (leave === undefined) throw new Error("seed changed: bob-perso-conges missing");
    expect(isExcludedPersonalData(leave, "alice")).toBe(true);
    expect(isExcludedPersonalData(leave, "bob")).toBe(false);
  });
});
