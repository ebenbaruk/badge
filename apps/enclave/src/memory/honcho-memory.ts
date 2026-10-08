import { z } from "zod";
import type { LlmClient } from "../llm/client";
import { dedupeHits, rankHits, type MemoryHit } from "./ranking";
import {
  DEFAULT_SOURCE_KINDS,
  normalizeNote,
  OwnerIdSchema,
  type CandidateExcerpt,
  type ExcerptSourceKind,
  type FindCandidatesOptions,
  type IngestResult,
  type MemoryNote,
  type MemoryNoteInput,
  type MemoryStore,
  type OwnerId,
} from "./types";

/**
 * Storage and retrieval primitives the memory layer needs. HonchoBackend implements it against Honcho; tests use
 * an in-memory fake.
 */
export interface MemoryBackend {
  /** Every owner with a context: the company peer and each employee peer. */
  listOwners(): Promise<OwnerId[]>;
  hasNote(ownerId: OwnerId, noteId: string): Promise<boolean>;
  addNote(note: MemoryNote): Promise<void>;
  /** Owner's notes matching the query (Honcho: hybrid semantic + full-text search). */
  searchNotes(ownerId: OwnerId, query: string, limit: number): Promise<MemoryHit[]>;
  /** Owner's derived conclusions matching the query (Honcho: semantic search over the representation). */
  searchConclusions(ownerId: OwnerId, query: string, limit: number): Promise<MemoryHit[]>;
}

/** Embeddings only: retrieval never needs a chat model. */
export type Embedder = Pick<LlmClient, "embed">;

export const DEFAULT_CANDIDATE_LIMIT = 8;
/**
 * Below this cosine similarity an excerpt is treated as unrelated. Calibrated on the demo dataset with
 * text-embedding-3-small at 384 dimensions: for the Orion brief, Orion notes score 0.41-0.59 and the off-topic HR
 * note 0.20. Short notes about the same business share a lot of vocabulary, so scores are compressed: this is a
 * coarse recall filter, the relevance classifier and the policy engine make the real decision. Recalibrate per
 * embedding model.
 */
export const DEFAULT_MIN_SCORE = 0.35;
/** Hits fetched per owner and per source kind before global ranking. */
export const DEFAULT_PER_OWNER_LIMIT = 5;

const TaskSchema = z.string().trim().min(1, "task must not be empty");

/**
 * The enclave's memory: ingestion into the owner's context and cross-scope retrieval of candidate excerpts.
 *
 * Trust boundary: this class reads every scope (company and all employees) because it runs inside the enclave with
 * Honcho's admin key. Its output is a list of *candidates*, never an answer: nothing it returns may leave the
 * enclave until the policy engine has checked consent for each personal excerpt.
 */
export class HonchoMemory implements MemoryStore {
  constructor(
    private readonly backend: MemoryBackend,
    private readonly embedder: Embedder,
    private readonly perOwnerLimit: number = DEFAULT_PER_OWNER_LIMIT,
  ) {}

  /**
   * Stores a note in its owner's context. Idempotent: a note whose id is already stored is skipped.
   * @throws {z.ZodError} on invalid input; backend errors propagate.
   */
  async ingest(input: MemoryNoteInput): Promise<IngestResult> {
    const note = normalizeNote(input);
    if (await this.backend.hasNote(note.ownerId, note.id)) return { noteId: note.id, created: false };
    await this.backend.addNote(note);
    return { noteId: note.id, created: true };
  }

  /**
   * Finds the excerpts most related to a task across the company context and every employee's context, ranked by
   * embedding similarity. One embeddings call per search (task + all hits in one batch).
   */
  async findCandidates(task: string, options: FindCandidatesOptions): Promise<CandidateExcerpt[]> {
    const query = TaskSchema.parse(task);
    const requesterId = OwnerIdSchema.parse(options.requesterId);
    const kinds = options.sourceKinds ?? DEFAULT_SOURCE_KINDS;
    const owners = await this.backend.listOwners();

    const perOwner = await Promise.all(
      owners.flatMap((owner) => kinds.map((kind) => this.search(owner, kind, query))),
    );
    const hits = dedupeHits(perOwner.flat());
    if (hits.length === 0) return [];

    const [taskVector, ...hitVectors] = await this.embedder.embed([query, ...hits.map((hit) => hit.text)]);
    if (!taskVector) throw new RangeError("embedder returned no vector for the task");
    return rankHits(taskVector, hits, hitVectors, {
      requesterId,
      limit: options.limit ?? DEFAULT_CANDIDATE_LIMIT,
      minScore: options.minScore ?? DEFAULT_MIN_SCORE,
    });
  }

  private search(owner: OwnerId, kind: ExcerptSourceKind, query: string): Promise<MemoryHit[]> {
    return kind === "note"
      ? this.backend.searchNotes(owner, query, this.perOwnerLimit)
      : this.backend.searchConclusions(owner, query, this.perOwnerLimit);
  }
}
