import { describe, expect, it } from "vitest";
import { isDeviceAscii, MAX_REVOKE_LABEL_LENGTH, revocationTargetLabel } from "../src";

describe("revocationTargetLabel", () => {
  it("names the real scope, including the team agreements of a revoke-all", () => {
    expect(
      revocationTargetLabel({ kind: "recipient", recipientName: "Alice Martin", recipientTeam: "Sales" }),
    ).toBe("Everything I shared with Alice Martin + Sales team agreements");
    expect(revocationTargetLabel({ kind: "policy", granteeTeam: "Sales", contextTag: "morpho" })).toBe(
      "Sales team agreement - morpho",
    );
    expect(
      revocationTargetLabel({
        kind: "grant",
        recipientName: "Alice Martin (Sales)",
        excerptLabel: "Morpho: AX-500",
      }),
    ).toBe("Alice Martin (Sales) - Morpho: AX-500");
  });

  it("is device ASCII and bounded whatever the names", () => {
    const label = revocationTargetLabel({
      kind: "policy",
      granteeTeam: "Équipe très longue ".repeat(20),
      contextTag: "tag",
    });
    expect(isDeviceAscii(label)).toBe(true);
    expect(label.length).toBeLessThanOrEqual(MAX_REVOKE_LABEL_LENGTH);
  });
});
