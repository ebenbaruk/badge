/**
 * Scripted brief drafting (pure). The real enclave asks the confidential LLM to write the brief from the allowed
 * excerpts only; the mock does the same with hand-written sentences per seeded note, so a missing consent visibly
 * removes facts from the brief.
 */
import type { BriefView } from "../enclave/types";
import type { TaskSource } from "./state";

/** One brief line per seeded note: what an analyst would extract from it. */
const NOTE_BULLETS: Readonly<Record<string, string>> = {
  "company-client-orion":
    "Key account since 2021: 14 warehouses (France, Benelux), about 35,000 AX-200 installed; framework agreement runs until December 31, 2026.",
  "alice-objectif-orion":
    "Meeting goal (October 8, 10 am): renew the framework agreement for 2027 and pitch the AX-500 for the new warehouses.",
  "bob-orion-conditions-2025":
    "2025 terms: 12% discount above 40,000 units, payment at 60 days end of month (approved in January).",
  "bob-orion-reunion-septembre":
    "Expectations voiced on September 22 by Marc Lefevre (purchasing): quarterly deliveries, a committed 3-week lead time; concerned about the price of the GW-10 gateway.",
  "bob-orion-points-attention":
    "What is at stake in the renewal: 4 warehouses opening in 2027 (about 8,000 sensors) and a competing offer at 15% off; the CFO's office signs off above EUR 1M.",
  "company-politique-tarifaire":
    "Internal rules: any discount above 8% needs sales management sign-off; legal review above EUR 500k.",
  "company-catalogue-2026":
    "2026 prices: AX-200 at EUR 118, AX-500 at EUR 245, GW-10 gateway at EUR 890 (excl. VAT).",
  "company-organisation":
    "Bob Durand (Key Accounts) owns Orion; Chloé Bernard (Legal & Compliance) approves contracts.",
  "bob-research-marche-capteurs":
    "European connected-sensor market: +9% in 2026; radio chips down 18% over the quarter, leaving room on gateway margins.",
};

const ORION_NEGOTIATION_NOTES = ["bob-orion-conditions-2025", "bob-orion-points-attention"];
const MAX_GENERIC_BULLET_LENGTH = 220;

function firstSentence(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return sentence.length > MAX_GENERIC_BULLET_LENGTH
    ? `${sentence.slice(0, MAX_GENERIC_BULLET_LENGTH - 1)}…`
    : sentence;
}

/**
 * Drafts the brief from `sources` only. A source bundles one or more notes (`noteIds`), so a consent covering
 * several of Bob's notes yields several lines, all citing the same source.
 */
export function draftBrief(task: string, sources: readonly TaskSource[]): BriefView {
  const bullets: BriefView["bullets"] = [];
  const allowedNotes = new Set<string>();
  for (const source of sources) {
    source.noteIds.forEach((noteId, index) => {
      allowedNotes.add(noteId);
      const text = NOTE_BULLETS[noteId] ?? firstSentence(source.noteTexts[index] ?? source.text);
      bullets.push({ text, sourceIds: [source.id] });
    });
  }
  const isOrion = /orion/i.test(task);
  const brief: BriefView = { title: isOrion ? "Brief: Orion Logistique meeting" : "Brief", bullets };
  if (isOrion && ORION_NEGOTIATION_NOTES.every((id) => allowedNotes.has(id))) {
    brief.recommendation =
      "Defend the renewal on installed value (35,000 sensors) rather than on price: pitch the AX-500 for the 4 new warehouses with a tiered discount, never above 12% without sales management sign-off.";
  } else if (isOrion) {
    brief.recommendation =
      "Without Bob's negotiation notes, stick to the renewal goal and do not commit to any discount.";
  }
  return brief;
}
