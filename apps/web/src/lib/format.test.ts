import { describe, expect, it } from "vitest";
import { estimateTokens, formatLength, formatRelative, percentSaved, plural, shortHex } from "./format";

/** French number formatting uses a narrow no-break space as thousands separator. */
const NNBSP = " ";

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

  it("formats lengths and plurals the French way", () => {
    expect(formatLength(1058)).toBe(`1${NNBSP}058 car.`);
    expect(plural(1, "extrait")).toBe("1 extrait");
    expect(plural(3, "extrait candidat", "extraits candidats")).toBe("3 extraits candidats");
  });

  it("formats relative times", () => {
    const now = new Date("2026-10-07T10:00:00Z");
    expect(formatRelative("2026-10-08T10:00:00Z", now)).toBe("demain");
    expect(formatRelative("2026-10-07T09:55:00Z", now)).toBe("il y a 5 minutes");
    expect(formatRelative("2026-10-07T10:00:10Z", now)).toBe("à l'instant");
  });
});
