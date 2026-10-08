import { describe, expect, it } from "vitest";
import {
  activeStepIndex,
  heroGate,
  scrollProgress,
  scrollTravel,
  smoothstep,
  unfoldAmount,
} from "./scroll-math";

describe("scrollProgress", () => {
  it("runs from 0 at the top of a tall element to 1 at its end", () => {
    expect(scrollProgress(100, 1650, 1000)).toBe(0);
    expect(scrollProgress(0, 1650, 1000)).toBe(0);
    expect(scrollProgress(-325, 1650, 1000)).toBeCloseTo(0.5);
    expect(scrollProgress(-2000, 1650, 1000)).toBe(1);
  });

  it("never divides by zero for an element no taller than the viewport", () => {
    expect(scrollProgress(10, 800, 1000)).toBe(0);
    expect(scrollProgress(-10, 800, 1000)).toBe(1);
  });
});

describe("scrollTravel", () => {
  it("is 0 when the element is centred and clamps to [-1, 1]", () => {
    expect(scrollTravel(250, 500, 1000)).toBe(0);
    expect(scrollTravel(5000, 500, 1000)).toBe(-1);
    expect(scrollTravel(-5000, 500, 1000)).toBe(1);
  });
});

describe("smoothstep and gates", () => {
  it("eases between 0 and 1", () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(2)).toBe(1);
  });

  it("holds personal context until the hero has been scrolled", () => {
    expect(heroGate(0)).toBe(0);
    expect(heroGate(1)).toBe(1);
  });

  it("unfolds the demo panel as it rises into view", () => {
    expect(unfoldAmount(2000, 1000)).toBe(0);
    expect(unfoldAmount(-500, 1000)).toBe(1);
    const halfway = unfoldAmount(920 - 325, 1000);
    expect(halfway).toBeGreaterThan(0.4);
    expect(halfway).toBeLessThan(0.6);
  });
});

describe("activeStepIndex", () => {
  it("picks the step closest to the reading line", () => {
    const steps = [
      { top: -400, height: 300 },
      { top: 300, height: 300 },
      { top: 900, height: 300 },
    ];
    expect(activeStepIndex(steps, 500)).toBe(1);
    expect(activeStepIndex(steps, 1100)).toBe(2);
    expect(activeStepIndex([], 500)).toBe(0);
  });
});
