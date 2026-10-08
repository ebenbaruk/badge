/**
 * Which discovered candidates are proposed for a task. The LLM classifier is advisory: this deterministic gate
 * turns its answer (plus the owner's own tags) into a decision, so a lenient model cannot widen what is offered to
 * owners for signature. Data minimisation comes first: asking an owner to share a note the task does not need is
 * noise on their Ledger at best, and a privacy leak if they approve out of fatigue.
 */
import { toDeviceAscii } from "@badge/consent";
import type { ExcerptClassification } from "../memory/classifier";
import { COMPANY_OWNER_ID, type CandidateExcerpt } from "../memory/types";

/**
 * Below this confidence a colleague's note is not worth their signature. On the demo dataset the classifier rates
 * notes carrying facts the task needs at 0.9-1.0 and notes that merely mention the same subject at 0.5 or less.
 */
export const MIN_COLLEAGUE_RELEVANCE = 0.7;

/**
 * Tags an owner puts on private notes (the seed uses them; the web mock applies the same list). Such a note is never
 * proposed for someone else's task, whatever the classifier says. Compared in device ASCII, lower case.
 */
export const PRIVATE_TAGS: ReadonlySet<string> = new Set(["personal", "hr", "confidential"]);

/** Whether `tag` is a private tag, however it is spelled ("HR", "Personal", "Confidential", "confidéntial"...). */
export function isPrivateTag(tag: string): boolean {
  return PRIVATE_TAGS.has(toDeviceAscii(tag).toLowerCase());
}

/** The parts of a candidate the gate looks at. */
export type SelectableExcerpt = Pick<CandidateExcerpt, "ownerId" | "tags">;

/**
 * Whether a discovered candidate is used for the requester's task. Company context and the requester's own notes
 * only need to be relevant: nothing leaves anyone's scope with them. A colleague's note must also be clearly
 * relevant ({@link MIN_COLLEAGUE_RELEVANCE}) and free of personal matters, flagged by the classifier or tagged
 * private by its owner: it would otherwise reach their Ledger as a request to sign.
 */
export function servesTask(
  excerpt: SelectableExcerpt,
  classification: ExcerptClassification,
  requesterId: string,
): boolean {
  if (!classification.relevant) return false;
  const fromColleague = excerpt.ownerId !== COMPANY_OWNER_ID && excerpt.ownerId !== requesterId;
  if (!fromColleague) return true;
  const taggedPrivate = excerpt.tags.some(isPrivateTag);
  return (
    classification.relevance >= MIN_COLLEAGUE_RELEVANCE &&
    !classification.containsPersonalData &&
    !taggedPrivate
  );
}
