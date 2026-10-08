import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  formatDateTime,
  formatLength,
  formatNumber,
  formatRelative,
  possessive,
  reasonForThirdParty,
  percentSaved,
  plural,
  shortHex,
} from "./format";

describe("format helpers", () => {
  it("estimates tokens at ~4 characters each, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("computes the share of tokens saved, bounded to [0, 100]", () => {
    expect(percentSaved(296, 667)).toBe(56);
    expect(percentSaved(0, 100)).toBe(100);
    expect(percentSaved(200, 100)).toBe(0);
    expect(percentSaved(10, 0)).toBe(0);
  });

  it("shortens long hex values and leaves short ones intact", () => {
    expect(shortHex("0x9858EfFD232B4033E47d90003D41EC34EcaEda94")).toBe("0x9858Ef…da94");
    expect(shortHex("0x1234")).toBe("0x1234");
  });

  it("formats numbers, lengths and plurals in US English", () => {
    expect(formatNumber(12480)).toBe("12,480");
    expect(formatLength(1058)).toBe("1,058 chars");
    expect(plural(1, "excerpt")).toBe("1 excerpt");
    expect(plural(0, "excerpt")).toBe("0 excerpts");
    expect(plural(3, "candidate excerpt", "candidate excerpts")).toBe("3 candidate excerpts");
  });

  it("formats dates in Paris time with an English month", () => {
    expect(formatDateTime("2026-10-08T08:00:00Z")).toBe("Oct 8, 2026, 10:00 AM");
  });

  it("formats relative times", () => {
    const now = new Date("2026-10-07T10:00:00Z");
    expect(formatRelative("2026-10-08T10:00:00Z", now)).toBe("tomorrow");
    expect(formatRelative("2026-10-07T09:55:00Z", now)).toBe("5 minutes ago");
    expect(formatRelative("2026-10-07T10:00:10Z", now)).toBe("just now");
  });

  it("builds English possessives", () => {
    expect(possessive("Alice")).toBe("Alice's");
    expect(possessive("Chloé Bernard")).toBe("Chloé Bernard's");
    expect(possessive("James")).toBe("James'");
  });
});

describe("reasonForThirdParty", () => {
  it("rephrases owner-addressed rule reasons for the compliance officer", () => {
    expect(reasonForThirdParty("The task asks for 100% of your personal context.", "Bob Durand")).toBe(
      "The task asks for 100% of Bob Durand's personal context.",
    );
    expect(
      reasonForThirdParty("The agent asks for your entire context, not a targeted excerpt.", "Bob Durand"),
    ).toBe("The agent asks for Bob Durand's entire context, not a targeted excerpt.");
    expect(reasonForThirdParty("12 requests on your context in the last hour.", "Alice Martin")).toBe(
      "12 requests on Alice Martin's context in the last hour.",
    );
  });

  it("leaves neutral reasons untouched and names an unknown owner generically", () => {
    expect(reasonForThirdParty("Unusually long excerpt (900 chars, threshold 600).", "Bob Durand")).toBe(
      "Unusually long excerpt (900 chars, threshold 600).",
    );
    expect(reasonForThirdParty("40% of your personal context.", null)).toBe(
      "40% of the owner's personal context.",
    );
  });
});
