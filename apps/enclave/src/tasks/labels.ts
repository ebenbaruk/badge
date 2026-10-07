/**
 * Labels shown on the Ledger. The device only renders ASCII and pages long strings, so labels are folded to device
 * ASCII and kept short enough to read at a glance.
 */
import { toDeviceAscii } from "@badge/consent";

/** Maximum length of an excerpt or task label on the device. */
export const DEVICE_LABEL_MAX_CHARS = 60;
const ELLIPSIS = "...";

/**
 * Folds `text` to device ASCII and truncates it to {@link DEVICE_LABEL_MAX_CHARS} on a word boundary, with "..."
 * when something was cut. Returns "" when nothing printable is left.
 */
export function deviceLabel(text: string, maxChars: number = DEVICE_LABEL_MAX_CHARS): string {
  const ascii = toDeviceAscii(text);
  if (ascii.length <= maxChars) return ascii;
  const room = maxChars - ELLIPSIS.length;
  const cut = ascii.slice(0, room + 1);
  const lastSpace = cut.lastIndexOf(" ");
  // Keep whole words unless that would leave too little to be useful.
  const head = lastSpace > room / 2 ? cut.slice(0, lastSpace) : ascii.slice(0, room);
  // Folding again trims trailing spaces and keeps the label canonical (what is signed is what is shown).
  return toDeviceAscii(`${head.replace(/[\s.,;:-]+$/, "")}${ELLIPSIS}`);
}

/** Label of an explicit request for someone's entire context, e.g. "Tout le contexte de Bob Durand". */
export function fullContextLabel(ownerName: string): string {
  return deviceLabel(`Tout le contexte de ${ownerName}`);
}
