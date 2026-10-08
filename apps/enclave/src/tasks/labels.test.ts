import { isDeviceAscii } from "@badge/consent";
import { describe, expect, it } from "vitest";
import { DEVICE_LABEL_MAX_CHARS, deviceLabel, fullContextLabel } from "./labels";

describe("deviceLabel", () => {
  it("keeps short text, folded to device ASCII", () => {
    expect(deviceLabel("Meeting « Orion » with Chloé")).toBe('Meeting " Orion " with Chloe');
  });

  it("cuts long text on a word boundary with an ellipsis, staying canonical", () => {
    const label = deviceLabel(
      "Orion meeting on September 22 with Marc Lefèvre (purchasing director): they want quarterly deliveries",
    );
    expect(label.length).toBeLessThanOrEqual(DEVICE_LABEL_MAX_CHARS);
    expect(label.endsWith("...")).toBe(true);
    expect(label).toBe("Orion meeting on September 22 with Marc Lefevre...");
    expect(isDeviceAscii(label)).toBe(true);
  });

  it("cuts a single long word hard", () => {
    expect(deviceLabel("x".repeat(100))).toBe(`${"x".repeat(57)}...`);
  });

  it("names a full-context request", () => {
    expect(fullContextLabel("Bob Durand")).toBe("Full context of Bob Durand");
  });
});
