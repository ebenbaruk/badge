/**
 * Pure display helpers (French locale). Client-safe.
 */

/**
 * Rough token estimate used by the token counter. ~4 characters per token is the usual rule of thumb for
 * BPE tokenizers on Latin text; the card compares two quantities measured the same way, so the ratio is what matters.
 */
export const CHARS_PER_TOKEN = 4;

const LOCALE = "fr-FR";
const PARIS_TIME_ZONE = "Europe/Paris";
const HEX_PREFIX_LENGTH = 2;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** "12 480" with a narrow no-break space, as French typography expects. */
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

/** "8 oct. 2026, 10:00" in Paris time (the demo company is in Lyon). */
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

/** "10:42:07" in Paris time, for timelines. */
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

/** "dans 23 heures", "il y a 5 minutes", "à l'instant". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const deltaMs = new Date(iso).getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(deltaMs) >= ms) return formatter.format(Math.round(deltaMs / ms), unit);
  }
  return "à l'instant";
}

/** "1 058 car." (characters, as on the device's "Longueur (car.)"). */
export function formatLength(characters: number): string {
  return `${formatNumber(characters)} car.`;
}

/** Plural helper for French UI copy: `plural(2, "extrait")` -> "2 extraits". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count > 1 ? pluralForm : singular}`;
}

/** French "de" before a name, elided before a vowel sound: `ofName("Alice")` -> "d'Alice", `ofName("Bob")` -> "de Bob". */
export function ofName(name: string): string {
  return /^[aeiouyàâéèêëîïôûüh]/i.test(name) ? `d'${name}` : `de ${name}`;
}

/**
 * The enclave writes rule reasons for the owner who reviews the request ("votre contexte"). The audit log shows the
 * same reasons to the compliance officer, for whom "votre" would wrongly point at her own context: rephrase them
 * in the third person, naming the owner.
 */
export function reasonForThirdParty(message: string, ownerName: string | null): string {
  const of = ownerName === null ? "du propriétaire" : ofName(ownerName);
  return message
    .replace(/de votre contexte personnel/g, `du contexte personnel ${of}`)
    .replace(/de votre contexte/g, `du contexte ${of}`)
    .replace(/sur votre contexte/g, `sur le contexte ${of}`);
}
