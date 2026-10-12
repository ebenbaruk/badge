/**
 * Scripted brief drafting (pure). The real enclave asks the confidential LLM to write the brief from the allowed
 * excerpts only; the mock does the same with hand-written sentences per seeded note, so a missing consent visibly
 * removes facts from the brief.
 */
import type { BriefView } from "../enclave/types";
import type { TaskSource } from "./state";

/** One brief line per seeded note: what an analyst would extract from it. */
const NOTE_BULLETS: Readonly<Record<string, string>> = {
  "company-client-morpho":
    "Client followed by Bob Durand (Key Accounts); open topics are the joint integration roadmap and shared documentation.",
  "alice-objectif-morpho":
    "Meeting goal (tomorrow, 10 am): agree on the next steps of the integration roadmap and present the new custody reporting.",
  "bob-morpho-conditions-2025":
    "Working terms: one shared channel for integration questions, a monthly review meeting, a written agenda the day before.",
  "bob-morpho-reunion-septembre":
    "Asked last month by their integrations lead: a shared sandbox before each release and one named contact; they want a simpler reporting format.",
  "bob-morpho-points-attention":
    "Watch-outs: keep the roadmap and the commercial discussion in separate threads; their team decides together, so send proposals in writing first.",
  "company-politique-tarifaire":
    "Internal rules: terms outside the published grid need sales management sign-off; partner contracts go through Legal & Compliance.",
  "company-catalogue-2026":
    "Catalog: custody, trading access, staking and onchain integration support, each quoted per client by Sales.",
  "company-organisation":
    "Bob Durand (Key Accounts) owns Morpho; Chloé Bernard (Legal & Compliance) approves contracts.",
  "bob-research-marche-capteurs":
    "Onchain lending is consolidating around curated vaults; stablecoin borrowing demand moved more than usual this quarter.",
};

const MORPHO_NEGOTIATION_NOTES = ["bob-morpho-conditions-2025", "bob-morpho-points-attention"];
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
  const isMorpho = /morpho/i.test(task);
  const brief: BriefView = { title: isMorpho ? "Brief: Morpho meeting" : "Brief", bullets };
  if (isMorpho && MORPHO_NEGOTIATION_NOTES.every((id) => allowedNotes.has(id))) {
    brief.recommendation =
      "Open on the integration roadmap, and keep commercial points for a written proposal sent to the shared channel before the monthly review meeting.";
  } else if (isMorpho) {
    brief.recommendation =
      "Without Bob's notes, stick to the roadmap goal and do not commit to any commercial term.";
  }
  return brief;
}
