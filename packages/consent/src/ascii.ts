/**
 * Device ASCII: the only text the Ledger renders. The Ethereum app shows non-ASCII EIP-712 strings as garbage or
 * refuses them, so every displayed string is folded to printable ASCII *before* it is signed. The folded form is
 * canonical (idempotent), which keeps the signed hash reproducible on the web app, the device and the enclave.
 */
import { NotDeviceAsciiError } from "./errors";

/** Code points rather than literal characters: many of them look identical to ASCII in an editor. */
const REPLACEMENT_TABLE: ReadonlyArray<readonly [codePoint: number, ascii: string]> = [
  // Quotes and apostrophes (French typography uses guillemets and the curly apostrophe).
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201a, "'"],
  [0x201b, "'"],
  [0x2032, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x201e, '"'],
  [0x201f, '"'],
  [0x2033, '"'],
  [0x00ab, '"'],
  [0x00bb, '"'],
  [0x2039, "'"],
  [0x203a, "'"],
  // Dashes, hyphens and minus.
  [0x2010, "-"],
  [0x2011, "-"],
  [0x2012, "-"],
  [0x2013, "-"],
  [0x2014, "-"],
  [0x2015, "-"],
  [0x2212, "-"],
  // Punctuation and symbols.
  [0x2026, "..."],
  [0x2022, "-"],
  [0x00b7, "."],
  [0x2044, "/"],
  [0x00d7, "x"],
  [0x00f7, "/"],
  [0x00b0, " deg"],
  [0x20ac, "EUR"],
  [0x00a3, "GBP"],
  [0x00a5, "JPY"],
  [0x00a9, "(c)"],
  [0x00ae, "(R)"],
  [0x2192, "->"],
  [0x2190, "<-"],
  // Letters without a canonical decomposition.
  [0x00df, "ss"],
  [0x00c6, "AE"],
  [0x00e6, "ae"],
  [0x0152, "OE"],
  [0x0153, "oe"],
  [0x00d8, "O"],
  [0x00f8, "o"],
  [0x0141, "L"],
  [0x0142, "l"],
  [0x0110, "D"],
  [0x0111, "d"],
  [0x00d0, "D"],
  [0x00f0, "d"],
  [0x00de, "Th"],
  [0x00fe, "th"],
  [0x0131, "i"],
];

/**
 * Characters that Unicode compatibility decomposition (NFKD) leaves untouched or folds badly, with their ASCII
 * replacement. Applied after NFKD, so precomposed letters (e, a, c with accents) never need an entry here.
 */
export const DEVICE_ASCII_REPLACEMENTS: ReadonlyMap<string, string> = new Map(
  REPLACEMENT_TABLE.map(([codePoint, ascii]) => [String.fromCodePoint(codePoint), ascii]),
);

const COMBINING_MARKS = /\p{M}/gu;
/** Any Unicode whitespace (newlines, tabs, NBSP, narrow NBSP, thin space...) becomes a single plain space. */
const ANY_WHITESPACE_RUN = /\s+/gu;
const NOT_PRINTABLE_ASCII = /[^\x20-\x7E]/g;

/**
 * Folds any string to canonical device ASCII: compatibility-decomposes it, strips diacritics, maps typographic
 * characters to ASCII (see {@link DEVICE_ASCII_REPLACEMENTS}), drops what is left outside printable ASCII
 * (0x20-0x7E), collapses whitespace and trims. Idempotent: `toDeviceAscii(toDeviceAscii(s)) === toDeviceAscii(s)`.
 *
 * NFKD rather than NFD on purpose: it also folds ligatures, full-width letters and superscripts to ASCII.
 */
export function toDeviceAscii(input: string): string {
  const decomposed = input.normalize("NFKD").replace(COMBINING_MARKS, "");
  let mapped = "";
  for (const char of decomposed) mapped += DEVICE_ASCII_REPLACEMENTS.get(char) ?? char;
  return mapped
    .replace(ANY_WHITESPACE_RUN, " ")
    .replace(NOT_PRINTABLE_ASCII, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** True when `value` is already canonical device ASCII, i.e. what the device shows is exactly what was signed. */
export function isDeviceAscii(value: string): boolean {
  return toDeviceAscii(value) === value;
}

/**
 * Throws {@link NotDeviceAsciiError} unless `value` is canonical device ASCII.
 * @param field - name used in the error message (e.g. `ContextShare.recipientName`).
 */
export function assertDeviceAscii(value: string, field = "value"): void {
  if (!isDeviceAscii(value)) throw new NotDeviceAsciiError(field, value);
}
