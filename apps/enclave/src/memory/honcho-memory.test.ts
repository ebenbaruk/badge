import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { FakeBackend, FakeLlm } from "../../test/fakes";
import { HonchoMemory } from "./honcho-memory";
import { normalizeNote } from "./types";

/** Toy embedding: one dimension per topic word, so similarity is predictable. */
const TOPICS = ["orion", "discount", "hr", "trade show"];
const embedText = (text: string) => {
  const lower = text.toLowerCase();
  return TOPICS.map((word) => (lower.includes(word) ? 1 : 0.01));
};

function setup() {
  const backend = new FakeBackend(["company", "alice", "bob", "chloe"]);
  const llm = new FakeLlm({ vectors: embedText });
  const memory = new HonchoMemory(backend, llm);
  return { backend, llm, memory };
}

describe("HonchoMemory.ingest", () => {
  it("stores a note once and reports re-ingestion as not created", async () => {
    const { backend, memory } = setup();
    const note = { ownerId: "bob", text: "Orion terms: 12% discount", tags: ["orion"] };
    await expect(memory.ingest(note)).resolves.toMatchObject({ created: true });
    await expect(memory.ingest(note)).resolves.toMatchObject({ created: false });
    expect(backend.notes).toHaveLength(1);
  });

  it("derives a stable id from owner and text when none is given", () => {
    const a = normalizeNote({ ownerId: "bob", text: "x" });
    expect(a.id).toMatch(/^bob-[0-9a-f]{16}$/);
    expect(normalizeNote({ ownerId: "bob", text: "x" }).id).toBe(a.id);
    expect(normalizeNote({ ownerId: "alice", text: "x" }).id).not.toBe(a.id);
  });

  it("rejects invalid notes", async () => {
    const { memory } = setup();
    await expect(memory.ingest({ ownerId: "Bob!", text: "x" })).rejects.toBeInstanceOf(ZodError);
    await expect(memory.ingest({ ownerId: "bob", text: "   " })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("HonchoMemory.findCandidates", () => {
  async function seeded() {
    const ctx = setup();
    await ctx.memory.ingest({
      id: "orion-conditions",
      ownerId: "bob",
      text: "Orion: 12% discount above 40k",
    });
    await ctx.memory.ingest({
      id: "orion-client",
      ownerId: "company",
      text: "Orion is a key account client",
    });
    await ctx.memory.ingest({ id: "rh", ownerId: "chloe", text: "Confidential HR file" });
    await ctx.memory.ingest({ id: "salon", ownerId: "company", text: "Trade show in March" });
    ctx.backend.conclusions.push({
      ownerId: "bob",
      kind: "conclusion",
      id: "c1",
      text: "According to bob, Orion gets a discount",
      tags: [],
    });
    return ctx;
  }

  it("merges every owner's context, ranks it and drops unrelated excerpts", async () => {
    const { memory, llm } = await seeded();
    const candidates = await memory.findCandidates("brief Orion discount", {
      requesterId: "alice",
      minScore: 0.5,
    });
    expect(candidates.map((c) => c.source.id)).toEqual(["orion-conditions", "orion-client"]);
    expect(candidates[0]).toMatchObject({ ownerId: "bob", scope: "personal", ownedByRequester: false });
    expect(candidates[1]).toMatchObject({ ownerId: "company", scope: "global" });
    expect(llm.embedCalls).toBe(1);
  });

  it("searches notes only by default and conclusions on request", async () => {
    const { memory } = await seeded();
    const notesOnly = await memory.findCandidates("Orion discount", { requesterId: "alice", minScore: 0 });
    expect(notesOnly.every((c) => c.source.kind === "note")).toBe(true);
    const both = await memory.findCandidates("Orion discount", {
      requesterId: "alice",
      minScore: 0,
      sourceKinds: ["note", "conclusion"],
    });
    expect(both.map((c) => c.source.id)).toContain("c1");
  });

  it("returns nothing without calling the embedder when memory is empty", async () => {
    const { memory, llm } = setup();
    await expect(memory.findCandidates("Orion", { requesterId: "alice" })).resolves.toEqual([]);
    expect(llm.embedCalls).toBe(0);
  });

  it("validates the task and the requester", async () => {
    const { memory } = setup();
    await expect(memory.findCandidates(" ", { requesterId: "alice" })).rejects.toBeInstanceOf(ZodError);
    await expect(memory.findCandidates("Orion", { requesterId: "" })).rejects.toBeInstanceOf(ZodError);
  });
});
