import { describe, expect, it } from "vitest";
import type { ExcerptClassification } from "../memory/classifier";
import { MIN_COLLEAGUE_RELEVANCE, servesTask } from "./selection";

const RELEVANT: ExcerptClassification = {
  relevant: true,
  relevance: 0.9,
  containsPersonalData: false,
  reason: "Working terms with client Morpho.",
};
const BOB_MORPHO = { ownerId: "bob", tags: ["morpho", "terms"] };
const BOB_LEAVE = { ownerId: "bob", tags: ["personal"] };

describe("servesTask", () => {
  it("keeps a colleague's note that clearly serves the task", () => {
    expect(servesTask(BOB_MORPHO, RELEVANT, "alice")).toBe(true);
  });

  it("drops anything the classifier finds irrelevant, whoever owns it", () => {
    const irrelevant = { ...RELEVANT, relevant: false };
    expect(servesTask(BOB_MORPHO, irrelevant, "alice")).toBe(false);
    expect(servesTask({ ownerId: "company", tags: [] }, irrelevant, "alice")).toBe(false);
    expect(servesTask({ ownerId: "alice", tags: [] }, irrelevant, "alice")).toBe(false);
  });

  it("does not ask a colleague to sign for a note that only mentions the subject", () => {
    const lukewarm = { ...RELEVANT, relevance: MIN_COLLEAGUE_RELEVANCE - 0.2 };
    expect(servesTask(BOB_MORPHO, lukewarm, "alice")).toBe(false);
    expect(servesTask(BOB_MORPHO, { ...RELEVANT, relevance: MIN_COLLEAGUE_RELEVANCE }, "alice")).toBe(true);
    // Company context and own notes leave nobody's scope: relevance is enough.
    expect(servesTask({ ownerId: "company", tags: [] }, lukewarm, "alice")).toBe(true);
    expect(servesTask({ ownerId: "alice", tags: [] }, lukewarm, "alice")).toBe(true);
  });

  it("never proposes a colleague's personal matters, flagged by the classifier or tagged private", () => {
    // The demo case: Bob's leave reminder names the Morpho meeting, a lenient model may call it relevant.
    expect(servesTask(BOB_LEAVE, RELEVANT, "alice")).toBe(false);
    expect(servesTask(BOB_MORPHO, { ...RELEVANT, containsPersonalData: true }, "alice")).toBe(false);
    expect(servesTask({ ownerId: "chloe", tags: ["hr", "confidential"] }, RELEVANT, "alice")).toBe(false);
  });

  it("recognises private tags whatever their case or accents", () => {
    for (const tags of [["HR"], ["Personal"], ["CONFIDENTIAL"], ["Confidéntial"], [" hr "]]) {
      expect(servesTask({ ownerId: "bob", tags }, RELEVANT, "alice")).toBe(false);
    }
  });

  it("keeps the requester's own personal notes", () => {
    const personal = { ...RELEVANT, containsPersonalData: true };
    expect(servesTask(BOB_LEAVE, personal, "bob")).toBe(true);
  });
});
