/**
 * Pure maths behind the landing's scroll choreography (kept out of React so they are unit-tested).
 * Every input is a viewport-relative measure (`getBoundingClientRect`), so nothing reads `scrollY`.
 */

/** Clamps `value` to [min, max]. */
export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** Hermite smoothstep on [0, 1]: slow start, slow end (the unfold and the hero gate use it). */
export function smoothstep(value: number): number {
  const m = clamp(value);
  return m * m * (3 - 2 * m);
}

/**
 * How far the page has scrolled through a tall element whose child is sticky: 0 when its top
 * reaches the top of the viewport, 1 when its bottom reaches the bottom.
 */
export function scrollProgress(top: number, height: number, viewport: number): number {
  const runway = height - viewport;
  if (runway <= 0) return top <= 0 ? 1 : 0;
  return clamp(-top / runway);
}

/**
 * Position of an element's centre relative to the viewport's centre, in viewport heights:
 * -1 below, 0 centred, 1 above (cards shrink and their art drifts as it grows).
 */
export function scrollTravel(top: number, height: number, viewport: number): number {
  if (viewport <= 0) return 0;
  return clamp((viewport / 2 - top - height / 2) / viewport, -1, 1);
}

/** Progress window of the hero over which personal-context streaks are released (the "+" turns into a "✓"). */
export const HERO_GATE_START = 0.3;
export const HERO_GATE_SPAN = 0.35;

/** 0 while personal context is held at the rim, 1 once the scroll has "signed" the hero. */
export function heroGate(progress: number): number {
  return smoothstep((progress - HERO_GATE_START) / HERO_GATE_SPAN);
}

/** Longest scroll distance (px) over which the demo panel unfolds, as on the reference site. */
export const UNFOLD_MAX_RANGE = 640;
/** Share of the viewport height used as the unfold range on short screens. */
export const UNFOLD_VIEWPORT_SHARE = 0.65;
/** The unfold starts when the panel's top reaches this share of the viewport height. */
export const UNFOLD_START_SHARE = 0.92;

/** Unfold state of the demo panel: 0 = folded into a nav-sized pill, 1 = full panel. */
export function unfoldAmount(top: number, viewport: number): number {
  const range = Math.min(UNFOLD_MAX_RANGE, viewport * UNFOLD_VIEWPORT_SHARE);
  if (range <= 0) return 1;
  return smoothstep((viewport * UNFOLD_START_SHARE - top) / range);
}

/**
 * Index of the step whose centre is closest to a reading line (the consent story lights the
 * step being read). Returns 0 for an empty list.
 */
export function activeStepIndex(
  steps: readonly { readonly top: number; readonly height: number }[],
  readingLine: number,
): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  steps.forEach((step, index) => {
    const distance = Math.abs(step.top + step.height / 2 - readingLine);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}
