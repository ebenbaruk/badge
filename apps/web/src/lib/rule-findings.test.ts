import { describe, expect, it } from "vitest";
import { uniqueFindings } from "./rule-findings";

describe("uniqueFindings", () => {
  it("collapses the same rule and message reported once per excerpt, keeping first-seen order", () => {
    const full = { rule: "FULL_CONTEXT_REQUEST", outcome: "warn" as const, message: "100% of your context." };
    const long = { rule: "EXCERPT_LENGTH", outcome: "warn" as const, message: "Unusually long excerpt." };
    expect(uniqueFindings([full, long, { ...full }, full])).toEqual([full, long]);
  });

  it("keeps the same rule when its message differs", () => {
    const a = { rule: "EXCERPT_LENGTH", outcome: "warn" as const, message: "1,200 characters." };
    const b = { ...a, message: "2,400 characters." };
    expect(uniqueFindings([a, b])).toEqual([a, b]);
  });
});
