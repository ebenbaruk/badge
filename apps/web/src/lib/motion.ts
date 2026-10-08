/** Pure helpers behind the motion components (kept out of React so they are unit-tested). */

/** IntersectionObserver settings of the reference site: reveal slightly before the bottom edge. */
export const REVEAL_THRESHOLD = 0.08;
export const REVEAL_ROOT_MARGIN = "0px 0px -24px 0px";

/** One word of a letter-by-letter reveal; `index` of each letter runs across the whole text. */
export interface RevealWord {
  readonly letters: readonly { readonly char: string; readonly index: number }[];
  /** Whitespace that follows the word (kept so line breaks fall between words, never inside). */
  readonly trailing: string;
}

/**
 * Splits a heading into words and letters for the staggered reveal. Letters are split by code
 * point (`Array.from`) so accented French characters and emoji are never cut in half.
 */
export function splitForReveal(text: string): RevealWord[] {
  const words: RevealWord[] = [];
  let index = 0;
  for (const match of text.matchAll(/(\S+)(\s*)/g)) {
    const letters = Array.from(match[1] ?? "", (char) => ({ char, index: index++ }));
    words.push({ letters, trailing: match[2] ?? "" });
  }
  return words;
}

/**
 * Offset of a magnetic element towards the pointer: proportional to the pointer's distance from
 * the element's centre, clamped to `strength` pixels on each axis.
 */
export function magneticOffset(
  pointer: { readonly x: number; readonly y: number },
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  strength: number,
): { x: number; y: number } {
  const relative = (value: number, start: number, size: number) =>
    size === 0 ? 0 : Math.max(-1, Math.min(1, ((value - start) / size) * 2 - 1));
  return {
    x: relative(pointer.x, rect.left, rect.width) * strength,
    y: relative(pointer.y, rect.top, rect.height) * strength,
  };
}
