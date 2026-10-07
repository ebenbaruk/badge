import { describe, expect, it } from "vitest";
import { cosineSimilarity, dedupeHits, rankHits, type MemoryHit } from "./ranking";

const hit = (ownerId: string, id: string, text = id, kind: MemoryHit["kind"] = "note"): MemoryHit => ({
  ownerId,
  kind,
  id,
  text,
  tags: [],
});

describe("cosineSimilarity", () => {
  it("is 1 for collinear vectors, 0 for orthogonal ones and clamps negatives to 0", () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });

  it("refuses vectors of different sizes", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(RangeError);
  });
});

describe("dedupeHits", () => {
  it("drops the same item found twice and the same text stored twice by one owner", () => {
    const hits = [
      hit("bob", "a", "Orion 12 %"),
      hit("bob", "a"),
      hit("bob", "b", "  orion   12 % "),
      hit("alice", "c", "Orion 12 %"),
    ];
    expect(dedupeHits(hits).map((h) => `${h.ownerId}/${h.id}`)).toEqual(["bob/a", "alice/c"]);
  });
});

describe("rankHits", () => {
  const task = [1, 0, 0];
  const hits = [hit("company", "global"), hit("bob", "orion"), hit("chloe", "rh"), hit("alice", "own")];
  const vectors = [
    [0.8, 0.6, 0], // 0.8
    [0.95, 0.31, 0], // ~0.95
    [0.1, 0.99, 0], // ~0.1
    [0.6, 0.8, 0], // 0.6
  ];

  it("orders by similarity, drops scores under the floor and applies the limit", () => {
    const ranked = rankHits(task, hits, vectors, { requesterId: "alice", limit: 2, minScore: 0.3 });
    expect(ranked.map((c) => c.source.id)).toEqual(["orion", "global"]);
    const all = rankHits(task, hits, vectors, { requesterId: "alice", limit: 10, minScore: 0.3 });
    expect(all.map((c) => c.source.id)).toEqual(["orion", "global", "own"]);
  });

  it("labels scope and ownership", () => {
    const [orion, global, own] = rankHits(task, hits, vectors, {
      requesterId: "alice",
      limit: 10,
      minScore: 0.3,
    });
    expect(orion).toMatchObject({ ownerId: "bob", scope: "personal", ownedByRequester: false });
    expect(global).toMatchObject({ ownerId: "company", scope: "global", ownedByRequester: false });
    expect(own).toMatchObject({ ownerId: "alice", scope: "personal", ownedByRequester: true });
  });

  it("breaks ties deterministically by owner then id", () => {
    const tied = [hit("bob", "b"), hit("alice", "z"), hit("bob", "a")];
    const same = [task, task, task];
    const ranked = rankHits(task, tied, same, { requesterId: "x", limit: 10, minScore: 0 });
    expect(ranked.map((c) => `${c.ownerId}/${c.source.id}`)).toEqual(["alice/z", "bob/a", "bob/b"]);
  });

  it("refuses mismatched inputs", () => {
    expect(() => rankHits(task, hits, vectors.slice(1), { requesterId: "a", limit: 1, minScore: 0 })).toThrow(
      RangeError,
    );
  });
});
