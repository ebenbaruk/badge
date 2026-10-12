import { excerptLength, hashExcerpt, isDeviceAscii } from "@badge/consent";
import { describe, expect, it } from "vitest";
import { deviceLabel as enclaveDeviceLabel } from "../../../../enclave/src/tasks/labels";
import {
  CONTEXT_SHARE,
  EXAMPLE_MEASUREMENT,
  EXCERPT,
  EXCERPT_LABEL,
  TASK_LABEL,
  exampleDeviceLabel,
  shortHash,
} from "./example";

describe("landing example", () => {
  it("cuts the excerpt label exactly as the enclave does", () => {
    expect(EXCERPT_LABEL).toBe(enclaveDeviceLabel(EXCERPT));
    for (const text of [
      "Morpho",
      "a b",
      "Prepare tomorrow's meeting with Morpho and its risk team at noon",
    ]) {
      expect(exampleDeviceLabel(text)).toBe(enclaveDeviceLabel(text));
    }
  });

  it("shows the first 60 device characters of the excerpt, never a title", () => {
    expect(EXCERPT_LABEL.length).toBeLessThanOrEqual(60);
    expect(EXCERPT_LABEL.endsWith("...")).toBe(true);
    expect(EXCERPT.startsWith(EXCERPT_LABEL.slice(0, -3))).toBe(true);
  });

  it("draws the seven ContextShare fields in the descriptor's order", () => {
    expect(CONTEXT_SHARE.intent).toBe("Share an excerpt");
    expect(CONTEXT_SHARE.rows.map((row) => row.label)).toEqual([
      "Share with",
      "Excerpt",
      "Length (chars)",
      "Task",
      "Expires",
      "Fingerprint",
      "Enclave",
    ]);
    const value = (label: string): string | undefined =>
      CONTEXT_SHARE.rows.find((row) => row.label === label)?.value;
    expect(value("Share with")).toBe("Alice Martin (Sales)");
    expect(value("Length (chars)")).toBe(String(excerptLength(EXCERPT)));
    expect(value("Task")).toBe(TASK_LABEL);
    expect(value("Expires")).toBe("18:00 UTC");
    expect(value("Fingerprint")).toBe(shortHash(hashExcerpt(EXCERPT)));
    expect(value("Enclave")).toBe(shortHash(EXAMPLE_MEASUREMENT));
    expect(value("Fingerprint")).toMatch(/^0x[0-9a-f]{4}\.\.\.[0-9a-f]{4}$/);
  });

  it("keeps every drawn value in device ASCII", () => {
    for (const row of CONTEXT_SHARE.rows) expect(isDeviceAscii(row.value), row.label).toBe(true);
  });
});
