/**
 * Mock retrieval and classification (pure). The real enclave uses Honcho embeddings and an LLM classifier; the
 * mock reproduces their observable behaviour with deterministic keyword overlap, so the demo script is stable.
 */
import type { SeedNote } from "./seed";

/** Candidates kept after ranking (the real memory layer returns a similar short list). */
export const MAX_CANDIDATES = 8;
/** Minimum overlap score for a note to be a candidate at all. */
export const MIN_CANDIDATE_SCORE = 2;
/** A tag match says more than a word match: tags are the owner's own classification. */
const TAG_WEIGHT = 2;
const MIN_TOKEN_LENGTH = 3;
/** Tags of personal data the classifier never forwards to someone else's task. */
export const SENSITIVE_TAGS: ReadonlySet<string> = new Set(["personal", "hr", "confidential"]);

/** Function words and task verbs that say nothing about which note is relevant. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "about",
  "this",
  "that",
  "these",
  "those",
  "are",
  "was",
  "were",
  "our",
  "your",
  "you",
  "its",
  "their",
  "they",
  "who",
  "what",
  "which",
  "prepare",
  "make",
  "give",
  "write",
  "draft",
  "brief",
]);

/** Lower-case, accent-free word stems (crude plural folding) of length >= 3, without stopwords. */
export function tokenize(text: string): Set<string> {
  const words = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const tokens = new Set<string>();
  for (const word of words) {
    if (word.length < MIN_TOKEN_LENGTH || STOPWORDS.has(word)) continue;
    tokens.add(word.endsWith("s") && word.length > MIN_TOKEN_LENGTH ? word.slice(0, -1) : word);
  }
  return tokens;
}

export interface Candidate {
  note: SeedNote;
  score: number;
}

/** Ranks every note (all scopes: the enclave sees everything) by overlap with the task. */
export function findCandidates(task: string, notes: readonly SeedNote[]): Candidate[] {
  const query = tokenize(task);
  const scored: Candidate[] = [];
  for (const note of notes) {
    const textTokens = tokenize(note.text);
    const tagTokens = tokenize(note.tags.join(" "));
    let score = 0;
    for (const token of query) {
      if (tagTokens.has(token)) score += TAG_WEIGHT;
      else if (textTokens.has(token)) score += 1;
    }
    if (score >= MIN_CANDIDATE_SCORE) scored.push({ note, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.note.id.localeCompare(b.note.id))
    .slice(0, MAX_CANDIDATES);
}

/**
 * Classifier stand-in: personal-data notes of someone else are never relevant to a work task. The requester's own
 * notes and the company context are always eligible.
 */
export function isExcludedPersonalData(note: SeedNote, requester: string): boolean {
  return note.owner !== "company" && note.owner !== requester && note.tags.some((t) => SENSITIVE_TAGS.has(t));
}
