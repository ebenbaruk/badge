/**
 * The landing's illustrative example: one consent request in a Coinbase workspace, built from the real descriptor,
 * labels and hashing of `@badge/consent`, so the Ledger screens drawn on the page are the ones the device would show
 * for this text. Nothing here is live data.
 */
import {
  BADGE_DESCRIPTORS,
  excerptLength,
  hashExcerpt,
  toDeviceAscii,
  type BadgeMessageKind,
} from "@badge/consent";
import { keccak256, toHex, type Hex } from "viem";

/** Maximum length of an excerpt or task label on the device (apps/enclave/src/tasks/labels.ts). */
const DEVICE_LABEL_MAX_CHARS = 60;
const ELLIPSIS = "...";

/**
 * The enclave's `deviceLabel`: device ASCII, cut to 60 characters on a word boundary with "..." when something was
 * cut. Kept identical to apps/enclave/src/tasks/labels.ts; example.test.ts compares both on the example text.
 */
export function exampleDeviceLabel(text: string, maxChars: number = DEVICE_LABEL_MAX_CHARS): string {
  const ascii = toDeviceAscii(text);
  if (ascii.length <= maxChars) return ascii;
  const room = maxChars - ELLIPSIS.length;
  const cut = ascii.slice(0, room + 1);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > room / 2 ? cut.slice(0, lastSpace) : ascii.slice(0, room);
  return toDeviceAscii(`${head.replace(/[\s.,;:-]+$/, "")}${ELLIPSIS}`);
}

export const PEOPLE = {
  alice: { name: "Alice Martin", team: "Sales" },
  bob: { name: "Bob Durand", team: "Key Accounts" },
} as const;

/** "Alice Martin (Sales)": how the enclave names a person on a device. */
export function deviceName(person: { name: string; team: string }): string {
  return toDeviceAscii(`${person.name} (${person.team})`);
}

/** The short task label the web app derives from Alice's request ("Task" on the device). */
export const TASK_LABEL = "Morpho meeting brief";

/** Bob's note, as the consent card shows it in full. Neutral example content. */
export const EXCERPT =
  "Morpho account notes. Their team prefers a written agenda before any call. Their risk lead asks about custody reporting first, so start there. Keep pricing questions for the follow-up, after the risk review. The last meeting ended on integration timelines; they asked for a short written summary.";

/** Example expiry of Bob's consent. The device prints a full UTC datetime; the page keeps the time of day. */
export const EXPIRES_SHORT = "18:00 UTC";

/** Example enclave measurement (compose hash): fixed and recognisable, never a live value. */
export const EXAMPLE_MEASUREMENT: Hex = keccak256(toHex("badge/landing-example/v1"));

export const EXCERPT_LABEL = exampleDeviceLabel(EXCERPT);
export const EXCERPT_LENGTH = excerptLength(EXCERPT);
export const EXCERPT_FINGERPRINT: Hex = hashExcerpt(EXCERPT);

/** Short form of a 32-byte hash, as the page prints it ("0x9ea4...ad5f"). */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

export interface DeviceRow {
  label: string;
  value: string;
}

export interface DeviceReview {
  intent: string;
  rows: DeviceRow[];
}

/**
 * The review of a Badge message as the device shows it: the intent and the descriptor's fields, in the descriptor's
 * order and under its ASCII labels. `values` is keyed by field path; a missing path throws, so a descriptor change
 * cannot silently drop a field from the page.
 */
export function deviceReview(kind: BadgeMessageKind, values: Record<string, string>): DeviceReview {
  const descriptor = BADGE_DESCRIPTORS[kind];
  return {
    intent: descriptor.intent,
    rows: descriptor.fields.map((field) => {
      const value = values[field.path];
      if (value === undefined) throw new Error(`landing example: no value for ${kind}.${field.path}`);
      return { label: field.label, value };
    }),
  };
}

/** Bob's `ContextShare`: the seven fields of his Ledger screen, hashes shortened for the drawing. */
export const CONTEXT_SHARE = deviceReview("ContextShare", {
  recipientName: deviceName(PEOPLE.alice),
  excerptLabel: EXCERPT_LABEL,
  excerptLength: String(EXCERPT_LENGTH),
  taskLabel: TASK_LABEL,
  expiresAt: EXPIRES_SHORT,
  excerptHash: shortHash(EXCERPT_FINGERPRINT),
  enclaveMeasurement: shortHash(EXAMPLE_MEASUREMENT),
});
