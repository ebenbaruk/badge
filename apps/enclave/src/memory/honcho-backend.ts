import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Honcho, type Message, type Peer } from "@honcho-ai/sdk";
import { z } from "zod";
import { REPO_ROOT } from "../llm/env-file";
import { MemoryBackendError, MemoryConfigError } from "./errors";
import type { MemoryBackend } from "./honcho-memory";
import type { MemoryHit } from "./ranking";
import { OwnerIdSchema, type MemoryNote, type OwnerId } from "./types";

export const DEFAULT_HONCHO_URL = "http://127.0.0.1:8000";
export const DEFAULT_HONCHO_WORKSPACE = "acme";
/** Written by infra/stack.sh up (gitignored). */
export const DEFAULT_HONCHO_JWT_FILE = resolve(REPO_ROOT, "infra/.data/honcho-admin.jwt");

const HONCHO_TIMEOUT_MS = 30_000;
const NOTES_SESSION_PREFIX = "notes-";
const PAGE_SIZE = 100;

/**
 * Deriver instructions, set on the workspace. Without them Honcho's 3.2 prompt drops facts a peer reports about
 * third parties (clients, colleagues), which is exactly the knowledge Badge exists to share.
 */
export const DERIVER_CUSTOM_INSTRUCTIONS =
  "These messages are a professional's private work notes, or company-wide reference information. " +
  "Extract the facts they state about clients, deals, products, prices, people and HR matters " +
  "(names, roles, amounts, dates, terms), attributed as 'according to <peer id>'. " +
  "Write each conclusion in the language of the source message. When a later message changes a figure, " +
  "state the new value and that it replaces the old one.";

export interface HonchoConfig {
  readonly baseUrl: string;
  /** Admin JWT: the enclave reads every scope. Never given to an agent or an employee. */
  readonly adminJwt: string;
  readonly workspaceId: string;
}

const JwtSchema = z.string().regex(/^[\w-]+\.[\w-]+\.[\w-]+$/, "not a JWT");

/**
 * Loads the Honcho connection from BADGE_HONCHO_URL, BADGE_HONCHO_JWT_FILE and BADGE_HONCHO_WORKSPACE (defaults:
 * local stack, `infra/.data/honcho-admin.jwt`, workspace "acme").
 * @throws {MemoryConfigError} when the admin JWT file is missing or malformed.
 */
export function loadHonchoConfig(env: NodeJS.ProcessEnv = process.env): HonchoConfig {
  const jwtFile = resolve(env["BADGE_HONCHO_JWT_FILE"] || DEFAULT_HONCHO_JWT_FILE);
  if (!existsSync(jwtFile)) {
    throw new MemoryConfigError(`Honcho admin JWT not found at ${jwtFile} (run infra/stack.sh up)`);
  }
  const jwt = JwtSchema.safeParse(readFileSync(jwtFile, "utf8").trim());
  if (!jwt.success) throw new MemoryConfigError(`${jwtFile} does not contain a JWT`);
  return {
    baseUrl: env["BADGE_HONCHO_URL"] || DEFAULT_HONCHO_URL,
    adminJwt: jwt.data,
    workspaceId: env["BADGE_HONCHO_WORKSPACE"] || DEFAULT_HONCHO_WORKSPACE,
  };
}

/** Deriver queue progress for the workspace. */
export interface DeriverQueueStatus {
  readonly total: number;
  readonly completed: number;
  readonly pending: number;
  readonly inProgress: number;
}

const NoteMetadataSchema = z.object({
  noteId: z.string(),
  tags: z.array(z.string()).default([]),
});

/**
 * Honcho layout: one workspace per company; one peer per employee plus the "company" peer; each owner writes in its
 * own session `notes-<owner>`. Note id and tags travel in message metadata.
 */
export class HonchoBackend implements MemoryBackend {
  private readonly honcho: Honcho;

  constructor(config: HonchoConfig) {
    this.honcho = new Honcho({
      baseURL: config.baseUrl,
      apiKey: config.adminJwt,
      workspaceId: config.workspaceId,
      timeout: HONCHO_TIMEOUT_MS,
    });
  }

  async listOwners(): Promise<OwnerId[]> {
    return this.call("list peers", async () => {
      const owners: OwnerId[] = [];
      for await (const peer of await this.honcho.peers({ size: PAGE_SIZE })) {
        // Only peers that follow our id convention are contexts; anything else is ignored, not trusted.
        const id = OwnerIdSchema.safeParse(peer.id);
        if (id.success) owners.push(id.data);
      }
      return owners;
    });
  }

  async hasNote(ownerId: OwnerId, noteId: string): Promise<boolean> {
    return this.call(`look up note ${noteId}`, async () => {
      const session = await this.honcho.session(sessionIdOf(ownerId));
      const page = await session.messages({ filters: { metadata: { noteId } }, size: 1 });
      return page.items.length > 0;
    });
  }

  async addNote(note: MemoryNote): Promise<void> {
    await this.call(`add note ${note.id}`, async () => {
      const peer = await this.honcho.peer(note.ownerId);
      const session = await this.honcho.session(sessionIdOf(note.ownerId));
      await session.addPeers([peer]);
      await session.addMessages([
        peer.message(note.text, { metadata: { noteId: note.id, tags: [...note.tags] } }),
      ]);
    });
  }

  async searchNotes(ownerId: OwnerId, query: string, limit: number): Promise<MemoryHit[]> {
    return this.call(`search notes of ${ownerId}`, async () => {
      const peer = await this.peerOf(ownerId);
      const messages = await peer.search(query, { limit });
      return messages.filter((m) => m.peerId === ownerId).map((m) => toNoteHit(ownerId, m));
    });
  }

  async searchConclusions(ownerId: OwnerId, query: string, limit: number): Promise<MemoryHit[]> {
    return this.call(`search conclusions of ${ownerId}`, async () => {
      const peer = await this.peerOf(ownerId);
      const conclusions = await peer.conclusions.query(query, limit);
      return conclusions.map((c) => ({
        ownerId,
        kind: "conclusion" as const,
        id: c.id,
        text: c.content,
        tags: [],
      }));
    });
  }

  /** Sets the deriver instructions on the workspace (idempotent). */
  async configureWorkspace(customInstructions: string = DERIVER_CUSTOM_INSTRUCTIONS): Promise<void> {
    await this.call("configure workspace", () =>
      this.honcho.setConfiguration({ reasoning: { customInstructions } }),
    );
  }

  /** Current deriver queue for the workspace. */
  async deriverQueue(): Promise<DeriverQueueStatus> {
    return this.call("read deriver queue", async () => {
      const status = await this.honcho.queueStatus();
      return {
        total: status.totalWorkUnits,
        completed: status.completedWorkUnits,
        pending: status.pendingWorkUnits,
        inProgress: status.inProgressWorkUnits,
      };
    });
  }

  /** Number of conclusions the deriver produced about an owner (0 = empty representation). */
  async conclusionCount(ownerId: OwnerId): Promise<number> {
    return this.call(`count conclusions of ${ownerId}`, async () => {
      const peer = await this.peerOf(ownerId);
      const page = await peer.conclusions.list({ size: 1 });
      return page.total;
    });
  }

  private peerOf(ownerId: OwnerId): Promise<Peer> {
    return this.honcho.peer(ownerId);
  }

  /** Wraps SDK errors with the operation name; the original error is kept as `cause`. */
  private async call<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new MemoryBackendError(`Honcho: ${operation} failed: ${detail}`, { cause });
    }
  }
}

function sessionIdOf(ownerId: OwnerId): string {
  return `${NOTES_SESSION_PREFIX}${ownerId}`;
}

function toNoteHit(ownerId: OwnerId, message: Message): MemoryHit {
  const metadata = NoteMetadataSchema.safeParse(message.metadata);
  // Messages written outside ingest() have no note id: fall back to Honcho's message id.
  return metadata.success
    ? { ownerId, kind: "note", id: metadata.data.noteId, text: message.content, tags: metadata.data.tags }
    : { ownerId, kind: "note", id: message.id, text: message.content, tags: [] };
}
