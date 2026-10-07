import type { z } from "zod";
import type { ChatMessage, LlmClient } from "../src/llm/client";
import type { LlmProfile } from "../src/llm/profile";
import { resolveLlmProfile } from "../src/llm/profile";
import type { MemoryBackend } from "../src/memory/honcho-memory";
import type { MemoryHit } from "../src/memory/ranking";
import type { MemoryNote, OwnerId } from "../src/memory/types";

export const TEST_API_KEY = "sk-test-0123456789abcdef";

export const BUILD_VARS = {
  BUILD_LLM_BASE_URL: "https://api.example.test/v1/",
  BUILD_LLM_API_KEY: TEST_API_KEY,
  BUILD_LLM_MODEL: "chat-model",
  BUILD_EMBEDDING_MODEL: "embed-model",
  BUILD_EMBEDDING_DIMENSIONS: "384",
} as const;

export const PHALA_VARS = {
  PHALA_AI_BASE_URL: "https://inference.example.test/v1",
  PHALA_AI_API_KEY: TEST_API_KEY,
  PHALA_AI_MODEL: "qwen/test",
} as const;

export function testProfile(name: "build" | "phala" = "build"): LlmProfile {
  return resolveLlmProfile({ ...BUILD_VARS, ...PHALA_VARS }, { profile: name });
}

/** An LlmClient that records the prompts it receives and replays canned answers. */
export class FakeLlm implements LlmClient {
  readonly prompts: ChatMessage[][] = [];

  constructor(
    private readonly answers: {
      text?: string;
      structured?: unknown;
      vectors?: (text: string) => number[];
    } = {},
  ) {}

  async complete(messages: readonly ChatMessage[]): Promise<string> {
    this.prompts.push([...messages]);
    return this.answers.text ?? "";
  }

  async structuredCompletion<T>(schema: z.ZodType<T>, messages: readonly ChatMessage[]): Promise<T> {
    this.prompts.push([...messages]);
    return schema.parse(this.answers.structured);
  }

  embedCalls = 0;

  async embed(texts: readonly string[]): Promise<number[][]> {
    this.embedCalls++;
    const vectors = this.answers.vectors;
    if (!vectors) throw new Error("FakeLlm: no embeddings configured");
    return texts.map(vectors);
  }
}

/** In-memory MemoryBackend: search returns every item of the owner that shares a word with the query. */
export class FakeBackend implements MemoryBackend {
  readonly notes: MemoryNote[] = [];
  readonly conclusions: MemoryHit[] = [];

  constructor(private readonly owners: OwnerId[]) {}

  async listOwners(): Promise<OwnerId[]> {
    return [...this.owners];
  }

  async hasNote(ownerId: OwnerId, noteId: string): Promise<boolean> {
    return this.notes.some((n) => n.ownerId === ownerId && n.id === noteId);
  }

  async addNote(note: MemoryNote): Promise<void> {
    this.notes.push(note);
  }

  async searchNotes(ownerId: OwnerId, _query: string, limit: number): Promise<MemoryHit[]> {
    return this.notes
      .filter((n) => n.ownerId === ownerId)
      .slice(0, limit)
      .map((n) => ({ ownerId, kind: "note", id: n.id, text: n.text, tags: n.tags }));
  }

  async searchConclusions(ownerId: OwnerId, _query: string, limit: number): Promise<MemoryHit[]> {
    return this.conclusions.filter((c) => c.ownerId === ownerId).slice(0, limit);
  }
}

/** One queued answer of {@link fakeFetch}: a response, or `networkError` thrown as fetch does on a reset. */
export type FakeFetchResponse =
  { status?: number; body: unknown; headers?: Record<string, string> } | { networkError: Error };

/** Builds a fetch stub that answers each call with the next queued response and records requests. */
export function fakeFetch(responses: FakeFetchResponse[]) {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const impl: typeof fetch = async (input, init) => {
    const next = responses.shift();
    if (!next) throw new Error("fakeFetch: unexpected call");
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: init?.headers as Record<string, string>,
    });
    if ("networkError" in next) throw next.networkError;
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(text, {
      status: next.status ?? 200,
      headers: { "content-type": "application/json", ...next.headers },
    });
  };
  return { impl, requests };
}

/** A minimal OpenAI chat completion response. */
export function chatResponse(content: string | null, finishReason = "stop"): unknown {
  return { choices: [{ finish_reason: finishReason, message: { role: "assistant", content } }] };
}
