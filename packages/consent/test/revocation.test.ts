import { describe, expect, it } from "vitest";
import { isDeviceAscii, MAX_REVOKE_LABEL_LENGTH, revocationTargetLabel } from "../src";

describe("revocationTargetLabel", () => {
  it("names the real scope, including the team agreements of a revoke-all", () => {
    expect(
      revocationTargetLabel({ kind: "recipient", recipientName: "Alice Martin", recipientTeam: "Ventes" }),
    ).toBe("Tout ce que j'ai partage avec Alice Martin + accords equipe Ventes");
    expect(revocationTargetLabel({ kind: "policy", granteeTeam: "Ventes", contextTag: "orion" })).toBe(
      "Accord equipe Ventes - orion",
    );
    expect(
      revocationTargetLabel({
        kind: "grant",
        recipientName: "Alice Martin (Ventes)",
        excerptLabel: "Orion : AX-500",
      }),
    ).toBe("Alice Martin (Ventes) - Orion : AX-500");
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
