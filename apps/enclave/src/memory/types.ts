import { createHash } from "node:crypto";
import { z } from "zod";

/** Owner id of the company-wide (global) context. Every other owner id is an employee id. */
export const COMPANY_OWNER_ID = "company";

/** Honcho peer ids: lowercase, short, URL-safe. Employees are addressed by id (alice, bob, chloe). */
export const OwnerIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,62}$/, "owner id must be lowercase letters, digits or dashes");
export type OwnerId = z.infer<typeof OwnerIdSchema>;

export const NoteIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,127}$/, "note id must be a lowercase slug");

const MAX_NOTE_CHARS = 4_000;
const NOTE_ID_HASH_CHARS = 16;

export const MemoryNoteSchema = z.object({
  /** Stable id; when omitted it is derived from owner and text, which makes re-ingestion idempotent. */
  id: NoteIdSchema.optional(),
  ownerId: OwnerIdSchema,
  text: z.string().trim().min(1).max(MAX_NOTE_CHARS),
  tags: z.array(z.string().trim().min(1)).default([]),
});
export type MemoryNoteInput = z.input<typeof MemoryNoteSchema>;

/** A validated note with its final id. */
export interface MemoryNote {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly text: string;
  readonly tags: readonly string[];
}

/** global = company context (readable by every employee); personal = one employee's context. */
export type ContextScope = "global" | "personal";

/** note = a note exactly as its owner wrote it; conclusion = a fact Honcho's deriver extracted from notes. */
export type ExcerptSourceKind = "note" | "conclusion";

export interface ExcerptSource {
  readonly kind: ExcerptSourceKind;
  readonly id: string;
}

/**
 * A piece of context that may help with a task. Candidates are found across every scope: holding one does NOT
 * mean it may be shown to anyone. Only the policy engine (consent signatures, deterministic rules) decides what
 * leaves the enclave.
 */
export interface CandidateExcerpt {
  readonly ownerId: OwnerId;
  readonly scope: ContextScope;
  readonly text: string;
  readonly source: ExcerptSource;
  readonly tags: readonly string[];
  /** Cosine similarity between the task and the excerpt, in [0, 1] (negative similarities clamp to 0). */
  readonly score: number;
  /** The requester's own context: no third-party consent is needed for it. */
  readonly ownedByRequester: boolean;
}

export interface FindCandidatesOptions {
  /** Employee on whose behalf the task runs. */
  readonly requesterId: OwnerId;
  /** Maximum number of candidates returned (after ranking). */
  readonly limit?: number;
  /** Candidates under this similarity are dropped. */
  readonly minScore?: number;
  /** Which memory to search. Default: notes only (see {@link DEFAULT_SOURCE_KINDS}). */
  readonly sourceKinds?: readonly ExcerptSourceKind[];
}

export interface IngestResult {
  readonly noteId: string;
  /** false when the note was already stored (idempotent re-ingestion). */
  readonly created: boolean;
}

/** Memory as seen by the rest of the enclave. Implemented by HonchoMemory; faked in policy-engine tests. */
export interface MemoryStore {
  ingest(note: MemoryNoteInput): Promise<IngestResult>;
  findCandidates(task: string, options: FindCandidatesOptions): Promise<CandidateExcerpt[]>;
}

/**
 * Notes only by default: a consent signature covers the exact excerpt its owner wrote (and recognises), while
 * derived conclusions are paraphrases (often in English) that would duplicate the same fact under a second consent.
 */
export const DEFAULT_SOURCE_KINDS: readonly ExcerptSourceKind[] = ["note"];

/** Scope of an owner's context. */
export function scopeOf(ownerId: OwnerId): ContextScope {
  return ownerId === COMPANY_OWNER_ID ? "global" : "personal";
}

/**
 * Validates a note and assigns its id (content-derived when not given).
 * @throws {z.ZodError} on invalid input.
 */
export function normalizeNote(input: MemoryNoteInput): MemoryNote {
  const note = MemoryNoteSchema.parse(input);
  const id =
    note.id ??
    `${note.ownerId}-${createHash("sha256").update(`${note.ownerId}\n${note.text}`).digest("hex").slice(0, NOTE_ID_HASH_CHARS)}`;
  return { id, ownerId: note.ownerId, text: note.text, tags: note.tags };
}
