import { FLEX_SCREEN } from "@badge/ledger";
import { describe, expect, it } from "vitest";
import {
  classifyGesture,
  FLEX_SCREEN_SIZE,
  LONG_PRESS_MS,
  SWIPE_MIN_DISTANCE,
  toDevicePoint,
} from "./mirror";

const HALF_SIZE_RECT = { left: 100, top: 50, width: 240, height: 300 };

describe("toDevicePoint", () => {
  it("keeps the client-side screen size in sync with @badge/ledger", () => {
    expect(FLEX_SCREEN_SIZE).toEqual(FLEX_SCREEN);
  });

  it("scales CSS pixels to integer device pixels", () => {
    expect(toDevicePoint({ x: 100, y: 50 }, HALF_SIZE_RECT)).toEqual({ x: 0, y: 0 });
    expect(toDevicePoint({ x: 220, y: 200 }, HALF_SIZE_RECT)).toEqual({ x: 240, y: 300 });
    // 0.3 CSS px -> 0.6 device px: rounded, since Speculos rejects fractional coordinates.
    expect(toDevicePoint({ x: 100.3, y: 50.3 }, HALF_SIZE_RECT)).toEqual({ x: 1, y: 1 });
  });

  it("clamps points outside the screen to its edges", () => {
    expect(toDevicePoint({ x: 0, y: 0 }, HALF_SIZE_RECT)).toEqual({ x: 0, y: 0 });
    expect(toDevicePoint({ x: 9999, y: 9999 }, HALF_SIZE_RECT)).toEqual({ x: 479, y: 599 });
  });

  it("returns null while the element has no layout", () => {
    expect(toDevicePoint({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe("classifyGesture", () => {
  const at = { x: 240, y: 435 };

  it("is a tap when short and still", () => {
    expect(classifyGesture(at, at, 120)).toEqual({ kind: "tap", at });
  });

  it("is a hold from the long-press threshold on", () => {
    expect(classifyGesture(at, at, LONG_PRESS_MS)).toEqual({ kind: "hold", at });
  });

  it("is a swipe on a mostly horizontal leftward drag", () => {
    expect(classifyGesture(at, { x: at.x - SWIPE_MIN_DISTANCE, y: at.y + 10 }, 200)).toEqual({
      kind: "swipe-next",
    });
  });

  it("ignores rightward and vertical drags as swipes", () => {
    expect(classifyGesture(at, { x: at.x + 200, y: at.y }, 200).kind).toBe("tap");
    expect(classifyGesture(at, { x: at.x - 90, y: at.y - 200 }, 200).kind).toBe("tap");
  });
});
