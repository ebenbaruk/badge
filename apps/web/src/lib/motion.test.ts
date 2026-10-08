import { describe, expect, it } from "vitest";
import { magneticOffset, splitForReveal } from "./motion";

describe("splitForReveal", () => {
  it("numbers letters across words and keeps the whitespace between them", () => {
    const words = splitForReveal("Your consent.");
    expect(words.map((w) => w.letters.map((l) => l.char).join(""))).toEqual(["Your", "consent."]);
    expect(words[0]?.trailing).toBe(" ");
    expect(words[1]?.letters[0]?.index).toBe(4);
  });

  it("never splits an accented character", () => {
    const [word] = splitForReveal("Chloé");
    expect(word?.letters).toHaveLength(5);
  });

  it("returns nothing for blank text", () => {
    expect(splitForReveal("   ")).toEqual([]);
  });
});

describe("magneticOffset", () => {
  const rect = { left: 0, top: 0, width: 100, height: 50 };

  it("is zero at the centre", () => {
    expect(magneticOffset({ x: 50, y: 25 }, rect, 6)).toEqual({ x: 0, y: 0 });
  });

  it("is clamped to the strength outside the element", () => {
    expect(magneticOffset({ x: 500, y: -500 }, rect, 6)).toEqual({ x: 6, y: -6 });
  });
});
