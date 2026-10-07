/**
 * Geometry and gesture rules of the Ledger mirror (pure, client-safe): the mirrored screen is displayed at any CSS
 * size, while Speculos expects integer device pixels on the 480 x 600 Flex screen.
 */

/** Ledger Flex screen size in device pixels (same values as `FLEX_SCREEN` in @badge/ledger, which is server-only). */
export const FLEX_SCREEN_SIZE = { width: 480, height: 600 } as const;

/** A press held at least this long is forwarded as a long press ("Hold to sign"). */
export const LONG_PRESS_MS = 600;
/** Horizontal travel (device pixels) beyond which a press becomes a swipe to the next review page. */
export const SWIPE_MIN_DISTANCE = 80;

export interface Point {
  x: number;
  y: number;
}

/** Displayed rectangle of the mirrored screen, as returned by `getBoundingClientRect()`. */
export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converts a pointer position (client CSS pixels) to an integer device point, clamped to the screen.
 * Returns `null` when the rectangle is degenerate (element not laid out yet).
 */
export function toDevicePoint(client: Point, rect: DisplayRect): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const scaleX = FLEX_SCREEN_SIZE.width / rect.width;
  const scaleY = FLEX_SCREEN_SIZE.height / rect.height;
  return {
    x: clamp(Math.round((client.x - rect.left) * scaleX), 0, FLEX_SCREEN_SIZE.width - 1),
    y: clamp(Math.round((client.y - rect.top) * scaleY), 0, FLEX_SCREEN_SIZE.height - 1),
  };
}

export type MirrorGesture = { kind: "tap"; at: Point } | { kind: "hold"; at: Point } | { kind: "swipe-next" };

/**
 * Classifies a completed press. A leftward drag turns the review page (like a finger swipe on the device);
 * a long press is a hold; anything else is a tap at the press position.
 */
export function classifyGesture(down: Point, up: Point, durationMs: number): MirrorGesture {
  const dx = up.x - down.x;
  if (dx <= -SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(up.y - down.y)) return { kind: "swipe-next" };
  if (durationMs >= LONG_PRESS_MS) return { kind: "hold", at: down };
  return { kind: "tap", at: down };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
