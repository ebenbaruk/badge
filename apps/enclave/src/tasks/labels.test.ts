import { isDeviceAscii } from "@badge/consent";
import { describe, expect, it } from "vitest";
import { DEVICE_LABEL_MAX_CHARS, deviceLabel, fullContextLabel } from "./labels";

describe("deviceLabel", () => {
  it("keeps short text, folded to device ASCII", () => {
    expect(deviceLabel("Réunion « Orion »")).toBe('Reunion " Orion "');
  });

  it("cuts long text on a word boundary with an ellipsis, staying canonical", () => {
    const label = deviceLabel(
      "Réunion Orion du 22 septembre avec Marc Lefèvre (directeur des achats) : ils veulent des livraisons",
    );
    expect(label.length).toBeLessThanOrEqual(DEVICE_LABEL_MAX_CHARS);
    expect(label.endsWith("...")).toBe(true);
    expect(label).toBe("Reunion Orion du 22 septembre avec Marc Lefevre...");
    expect(isDeviceAscii(label)).toBe(true);
  });

  it("cuts a single long word hard", () => {
    expect(deviceLabel("x".repeat(100))).toBe(`${"x".repeat(57)}...`);
  });

  it("names a full-context request", () => {
    expect(fullContextLabel("Bob Durand")).toBe("Tout le contexte de Bob Durand");
  });
});
