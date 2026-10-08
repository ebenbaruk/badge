/**
 * Pure display helpers (US English locale, Paris time). Client-safe.
 */

/**
 * Rough token estimate used by the token counter. ~4 characters per token is the usual rule of thumb for
 * BPE tokenizers on Latin text; the card compares two quantities measured the same way, so the ratio is what matters.
 */
export const CHARS_PER_TOKEN = 4;

const LOCALE = "en-US";
const PARIS_TIME_ZONE = "Europe/Paris";
const HEX_PREFIX_LENGTH = 2;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** "12,480": thousands grouped with a comma. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

/**
 * Share of tokens saved by injecting only the selected context instead of everything, in whole percent [0, 100].
 * Returns 0 when there is no context at all (nothing to save, and avoids a division by zero).
 */
export function percentSaved(selectedTokens: number, allContextTokens: number): number {
  if (allContextTokens <= 0) return 0;
  const saved = 1 - selectedTokens / allContextTokens;
  return Math.round(Math.min(1, Math.max(0, saved)) * 100);
}

/** `0x9858ef…da94`: enough to recognise a value, short enough for a table cell. */
export function shortHex(value: string, head = 6, tail = 4): string {
  if (value.length <= HEX_PREFIX_LENGTH + head + tail + 1) return value;
  return `${value.slice(0, HEX_PREFIX_LENGTH + head)}…${value.slice(-tail)}`;
}

/** "Oct 8, 2026, 10:00 AM" in Paris time (the demo company is in Lyon). */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PARIS_TIME_ZONE,
  }).format(new Date(iso));
}

/** "10:42:07 AM" in Paris time, for timelines. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: PARIS_TIME_ZONE,
  }).format(new Date(iso));
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "in 23 hours", "5 minutes ago", "just now". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const deltaMs = new Date(iso).getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(deltaMs) >= ms) return formatter.format(Math.round(deltaMs / ms), unit);
  }
  return "just now";
}

/** "1,058 chars" (characters, as on the device's "Length (chars)"). */
export function formatLength(characters: number): string {
  return `${formatNumber(characters)} chars`;
}

/** Plural helper for UI copy: `plural(2, "excerpt")` -> "2 excerpts" (English: only exactly 1 is singular). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

/**
 * English possessive of a name: `possessive("Alice")` -> "Alice's", `possessive("Chloé Bernard")` -> "Chloé Bernard's".
 * Names ending in "s" take a bare apostrophe ("James'").
 */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

const UNKNOWN_OWNER_POSSESSIVE = "the owner's";

/**
 * The enclave writes rule reasons for the owner who reviews the request ("your context"). The audit log shows the
 * same reasons to the compliance officer, for whom "your" would wrongly point at her own context: rephrase them
 * in the third person, naming the owner. Every "your" in a reason addresses the owner, so each one is replaced.
 */
export function reasonForThirdParty(message: string, ownerName: string | null): string {
  const owners = ownerName === null ? UNKNOWN_OWNER_POSSESSIVE : possessive(ownerName);
  return message.replace(/\byour\b/gi, owners);
}
