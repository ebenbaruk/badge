import { describe, expect, it } from "vitest";
import { evaluateExtraction, type ExtractionRequest } from "./rules";

const ORDINARY: ExtractionRequest = {
  excerptLength: 567,
  ownerTotalLength: 1058,
  distinctOwnersInTask: 1,
  recentRequestsToOwner: 0,
  fullContextRequest: false,
};

describe("evaluateExtraction", () => {
  it("lets a task-scoped request through without findings", () => {
    expect(evaluateExtraction(ORDINARY)).toEqual({ outcome: "ok", findings: [] });
  });

  it("flags (but does not block) a compromised agent asking for a whole context", () => {
    const result = evaluateExtraction({ ...ORDINARY, excerptLength: 1058, fullContextRequest: true });
    expect(result.outcome).toBe("warn");
    expect(result.findings.map((f) => f.rule)).toEqual(["full-context", "excerpt-length", "owner-share"]);
  });

  it("blocks exports, fan-out over many owners and request floods", () => {
    expect(evaluateExtraction({ ...ORDINARY, excerptLength: 5000, ownerTotalLength: 50_000 }).outcome).toBe(
      "block",
    );
    expect(evaluateExtraction({ ...ORDINARY, distinctOwnersInTask: 4 }).outcome).toBe("block");
    expect(evaluateExtraction({ ...ORDINARY, recentRequestsToOwner: 7 }).outcome).toBe("block");
  });

  it("warns when the same owner is asked repeatedly within the hour", () => {
    const result = evaluateExtraction({ ...ORDINARY, recentRequestsToOwner: 3 });
    expect(result).toMatchObject({ outcome: "warn", findings: [{ rule: "owner-rate" }] });
  });
});
