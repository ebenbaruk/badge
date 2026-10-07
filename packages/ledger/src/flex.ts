/**
 * Ledger Flex screen geometry (480 x 600), as used by Speculos `--model flex`.
 * Positions come from Ledger's own test navigator (ragger `positions.py`) and were checked on Speculos.
 */

export const FLEX_SCREEN = { width: 480, height: 600 } as const;

/** A point on the device touch screen, in device pixels. */
export interface DevicePoint {
  x: number;
  y: number;
}

export const FLEX_POSITIONS = {
  center: { x: 240, y: 300 },
  /** "Hold to sign" / "Confirm" button of review and choice screens. */
  confirm: { x: 240, y: 435 },
  /** Bottom-left "Reject" of review screens, also "cancel" of choice screens. */
  reject: { x: 55, y: 530 },
  /** Bottom-right arrow: next page of a review. */
  nextPage: { x: 430, y: 550 },
  /** Start and end of the left swipe that turns a review page (more reliable than the arrow on every page). */
  swipeNextFrom: { x: 400, y: 300 },
  swipeNextTo: { x: 60, y: 300 },
} as const satisfies Record<string, DevicePoint>;

/**
 * How long "Hold to sign" must be held. The SDK needs at least 2.4 s for a long press; ragger uses 3 s.
 */
export const HOLD_TO_SIGN_MS = 3000;

/**
 * Converts a coordinate to what Speculos accepts: an integer inside the screen.
 * Speculos rejects non-integer coordinates with an HTTP 400 that is easy to miss, so we round here once for every
 * caller (including clicks forwarded from the web mirror, which come in CSS pixels).
 * @throws RangeError when the value is not a finite number.
 */
export function toDeviceCoordinate(value: number, axis: "x" | "y"): number {
  if (!Number.isFinite(value)) throw new RangeError(`Device ${axis} coordinate must be a finite number`);
  const max = (axis === "x" ? FLEX_SCREEN.width : FLEX_SCREEN.height) - 1;
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** Rounds and clamps a point with {@link toDeviceCoordinate}. */
export function toDevicePoint(point: DevicePoint): DevicePoint {
  return { x: toDeviceCoordinate(point.x, "x"), y: toDeviceCoordinate(point.y, "y") };
}
