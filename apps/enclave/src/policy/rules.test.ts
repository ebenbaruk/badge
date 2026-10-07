import { describe, expect, it } from "vitest";
import { evaluateExtraction, EXTRACTION_THRESHOLDS as T, type ExtractionInput } from "./rules";

/** A normal Orion brief: one owner, one note of ~200 characters out of ~1,000. */
const NORMAL: ExtractionInput = {
  excerptLength: 200,
  ownerContextLength: 1_000,
  requestedFromOwnerInTask: 650,
  distinctOwnersInTask: 1,
  ownerRequestsLastHour: 3,
  fullContextRequest: false,
};

const codes = (input: Partial<ExtractionInput>) =>
  evaluateExtraction({ ...NORMAL, ...input }).reasons.map((reason) => reason.code);

describe("evaluateExtraction", () => {
  it("lets a normal brief through", () => {
    expect(evaluateExtraction(NORMAL)).toEqual({ outcome: "ok", reasons: [] });
  });

  it("warns on a long excerpt and blocks above the hard cap", () => {
    expect(evaluateExtraction({ ...NORMAL, excerptLength: T.excerptWarnChars + 1 }).outcome).toBe("warn");
    const capped = evaluateExtraction({ ...NORMAL, excerptLength: T.excerptBlockChars + 1 });
    expect(capped.outcome).toBe("block");
    expect(capped.reasons[0]?.code).toBe("EXCERPT_OVER_CAP");
    expect(evaluateExtraction({ ...NORMAL, excerptLength: T.excerptBlockChars }).outcome).toBe("warn");
  });

  it("warns when the task takes (almost) all of the owner's context, or when its size is unknown", () => {
    expect(codes({ requestedFromOwnerInTask: 900 })).toEqual(["OWNER_SHARE_HIGH"]);
    expect(codes({ requestedFromOwnerInTask: 899 })).toEqual([]);
    expect(codes({ ownerContextLength: 0 })).toEqual(["OWNER_SHARE_HIGH"]);
  });

  it("warns on many owners in one task and blocks a sweep", () => {
    expect(codes({ distinctOwnersInTask: T.distinctOwnersWarn })).toEqual(["MANY_OWNERS"]);
    expect(evaluateExtraction({ ...NORMAL, distinctOwnersInTask: T.distinctOwnersBlock + 1 }).outcome).toBe(
      "block",
    );
  });

  it("warns, then blocks, on the request rate per owner", () => {
    expect(codes({ ownerRequestsLastHour: T.ownerRequestsPerHourWarn })).toEqual(["OWNER_RATE_HIGH"]);
    expect(
      evaluateExtraction({ ...NORMAL, ownerRequestsLastHour: T.ownerRequestsPerHourBlock }).outcome,
    ).toBe("block");
  });

  it("flags the trapped agent: full context of Bob in one excerpt, with every reason shown", () => {
    const verdict = evaluateExtraction({
      ...NORMAL,
      excerptLength: 1_000,
      requestedFromOwnerInTask: 1_000,
      fullContextRequest: true,
    });
    expect(verdict.outcome).toBe("warn");
    expect(verdict.reasons.map((r) => r.code)).toEqual([
      "EXCERPT_LONG",
      "OWNER_SHARE_HIGH",
      "FULL_CONTEXT_REQUEST",
    ]);
    for (const reason of verdict.reasons) expect(reason.message.length).toBeGreaterThan(10);
  });

  it("blocks the trapped agent when the dump exceeds the hard cap, whatever else", () => {
    const verdict = evaluateExtraction({
      ...NORMAL,
      excerptLength: 10_500,
      ownerContextLength: 11_000,
      requestedFromOwnerInTask: 10_500,
      fullContextRequest: true,
    });
    expect(verdict.outcome).toBe("block");
  });
});
