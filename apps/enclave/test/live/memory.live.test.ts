/**
 * Live checks against the local stack (infra/stack.sh up + seed) and the selected LLM profile (default: build).
 * Each run makes about 5 chat calls and 2 embedding calls.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  classifyExcerpt,
  createLlmClient,
  draftBrief,
  HonchoBackend,
  HonchoMemory,
  loadHonchoConfig,
  loadLlmProfile,
  loadSeedDataset,
  scopeOf,
  type CandidateExcerpt,
  type LlmClient,
} from "../../src";

const ORION_TASK = "brief du rendez-vous de demain avec le client Orion";
const dataset = loadSeedDataset();
const noteById = (id: string) => {
  const note = dataset.notes.find((n) => n.id === id);
  if (!note) throw new Error(`unknown note ${id}`);
  return note;
};

describe("memory layer on the local stack", () => {
  let llm: LlmClient;
  let memory: HonchoMemory;
  let candidates: CandidateExcerpt[];

  beforeAll(async () => {
    llm = createLlmClient(loadLlmProfile());
    memory = new HonchoMemory(new HonchoBackend(loadHonchoConfig()), llm);
    candidates = await memory.findCandidates(ORION_TASK, { requesterId: "alice" });
  });

  it("finds Bob's Orion conditions and not Chloe's HR note", () => {
    const ids = candidates.map((c) => c.source.id);
    expect(ids).toContain("bob-orion-conditions-2025");
    expect(ids).not.toContain("chloe-rh-prudhommes");
    expect(candidates.find((c) => c.source.id === "bob-orion-conditions-2025")).toMatchObject({
      ownerId: "bob",
      scope: "personal",
      ownedByRequester: false,
    });
  });

  it("classifies Bob's note as relevant business data", async () => {
    const result = await classifyExcerpt(llm, ORION_TASK, {
      ownerId: "bob",
      scope: "personal",
      text: noteById("bob-orion-conditions-2025").text,
    });
    expect(result.relevant).toBe(true);
    expect(result.relevance).toBeGreaterThanOrEqual(0.6);
    expect(result.containsPersonalData).toBe(false);
  });

  it("classifies Chloe's HR note as off-topic personal data", async () => {
    const result = await classifyExcerpt(llm, ORION_TASK, {
      ownerId: "chloe",
      scope: "personal",
      text: noteById("chloe-rh-prudhommes").text,
    });
    expect(result.relevant).toBe(false);
    expect(result.relevance).toBeLessThan(0.3);
    expect(result.containsPersonalData).toBe(true);
  });

  it("drafts a brief from the allowed excerpts only", async () => {
    const allowed = ["company-client-orion", "bob-orion-conditions-2025"].map(noteById).map((note) => ({
      ownerId: note.ownerId,
      scope: scopeOf(note.ownerId),
      text: note.text,
    }));
    const brief = await draftBrief(llm, ORION_TASK, allowed);
    expect(brief).toMatch(/12\s?%/);
    expect(brief).toMatch(/60/);
    // Facts from notes that were not released must not appear.
    expect(brief).not.toMatch(/Lef[eè]vre|Julien|prud/i);
  });
});
