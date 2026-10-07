import type { CandidateExcerpt, ExcerptSourceKind, OwnerId } from "./types";
import { scopeOf } from "./types";

/** A raw search hit from the memory backend, before scoring. */
export interface MemoryHit {
  readonly ownerId: OwnerId;
  readonly kind: ExcerptSourceKind;
  readonly id: string;
  readonly text: string;
  readonly tags: readonly string[];
}

/**
 * Cosine similarity of two vectors of the same size, clamped to [0, 1]: a negative similarity means "unrelated"
 * for ranking purposes.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new RangeError(`vector sizes differ: ${a.length} vs ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(normA * normB)));
}

/**
 * Removes duplicate hits: the same item found twice (same owner, kind and id), or the same text stored twice by
 * one owner. Order of first appearance is kept.
 */
export function dedupeHits(hits: readonly MemoryHit[]): MemoryHit[] {
  const seen = new Set<string>();
  const result: MemoryHit[] = [];
  for (const hit of hits) {
    const idKey = `${hit.ownerId}\u0000${hit.kind}\u0000${hit.id}`;
    const textKey = `${hit.ownerId}\u0000${normalizeText(hit.text)}`;
    if (seen.has(idKey) || seen.has(textKey)) continue;
    seen.add(idKey);
    seen.add(textKey);
    result.push(hit);
  }
  return result;
}

export interface RankOptions {
  readonly requesterId: OwnerId;
  readonly limit: number;
  readonly minScore: number;
}

/**
 * Scores hits against the task embedding and returns the best candidates, most similar first. Ties are broken
 * deterministically (owner, then id) so the same memory always yields the same order.
 */
export function rankHits(
  taskVector: readonly number[],
  hits: readonly MemoryHit[],
  hitVectors: readonly (readonly number[])[],
  options: RankOptions,
): CandidateExcerpt[] {
  if (hits.length !== hitVectors.length) {
    throw new RangeError(`${hits.length} hits but ${hitVectors.length} vectors`);
  }
  const scored = hits.map((hit, i): CandidateExcerpt => {
    const vector = hitVectors[i];
    if (!vector) throw new RangeError(`missing vector for hit #${i}`);
    return {
      ownerId: hit.ownerId,
      scope: scopeOf(hit.ownerId),
      text: hit.text,
      source: { kind: hit.kind, id: hit.id },
      tags: hit.tags,
      score: cosineSimilarity(taskVector, vector),
      ownedByRequester: hit.ownerId === options.requesterId,
    };
  });
  return scored
    .filter((candidate) => candidate.score >= options.minScore)
    .sort(
      (a, b) =>
        b.score - a.score || a.ownerId.localeCompare(b.ownerId) || a.source.id.localeCompare(b.source.id),
    )
    .slice(0, options.limit);
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
