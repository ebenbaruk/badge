/**
 * Scripted brief drafting (pure). The real enclave asks the confidential LLM to write the brief from the allowed
 * excerpts only; the mock does the same with hand-written sentences per seeded note, so a missing consent visibly
 * removes facts from the brief.
 */
import type { BriefView, SourceView } from "../enclave/types";

/** One brief line per seeded note: what an analyst would extract from it. */
const NOTE_BULLETS: Readonly<Record<string, string>> = {
  "company-client-orion":
    "Client grand compte depuis 2021 : 14 entrepôts (France, Benelux), environ 35 000 AX-200 installés ; contrat-cadre jusqu'au 31 décembre 2026.",
  "alice-objectif-orion":
    "Objectif du rendez-vous (8 octobre, 10 h) : renouveler le contrat-cadre 2027 et proposer l'AX-500 sur les nouveaux entrepôts.",
  "bob-orion-conditions-2025":
    "Conditions 2025 : remise de 12 % au-delà de 40 000 unités, paiement à 60 jours fin de mois (validé en janvier).",
  "bob-orion-reunion-septembre":
    "Attentes exprimées le 22 septembre par Marc Lefèvre (achats) : livraisons trimestrielles, délai garanti à 3 semaines ; inquiétude sur le prix de la passerelle GW-10.",
  "bob-orion-points-attention":
    "Enjeux du renouvellement : 4 entrepôts ouverts en 2027 (environ 8 000 capteurs) et une offre concurrente à -15 % ; la DAF valide au-delà de 1 M€.",
  "company-politique-tarifaire":
    "Cadre interne : toute remise au-delà de 8 % passe par la direction commerciale, revue juridique au-delà de 500 k€.",
  "company-catalogue-2026":
    "Tarifs 2026 : AX-200 à 118 € HT, AX-500 à 245 € HT, passerelle GW-10 à 890 € HT.",
  "company-organisation":
    "Bob Durand (Grands comptes) suit Orion ; Chloé Bernard (Juridique) valide les contrats.",
  "bob-research-marche-capteurs":
    "Marché européen des capteurs connectés : +9 % en 2026 ; puces radio -18 % sur le trimestre, marge disponible sur les passerelles.",
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
export function draftBrief(
  task: string,
  sources: ReadonlyArray<SourceView & { noteIds: readonly string[]; noteTexts: readonly string[] }>,
): BriefView {
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
  const brief: BriefView = { title: isOrion ? "Brief : rendez-vous Orion Logistique" : "Brief", bullets };
  if (isOrion && ORION_NEGOTIATION_NOTES.every((id) => allowedNotes.has(id))) {
    brief.recommendation =
      "Défendre le renouvellement sur la valeur installée (35 000 capteurs) plutôt que sur le prix : proposer l'AX-500 sur les 4 nouveaux entrepôts avec une remise par paliers, sans dépasser 12 % sans accord de la direction commerciale.";
  } else if (isOrion) {
    brief.recommendation =
      "Sans les notes de négociation de Bob, rester sur l'objectif de renouvellement et ne pas s'engager sur une remise.";
  }
  return brief;
}
