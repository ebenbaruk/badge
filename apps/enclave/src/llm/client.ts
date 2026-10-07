import { z } from "zod";
import { LlmOutputError, LlmRequestError } from "./errors";
import { toStrictJsonSchema } from "./json-schema";
import type { LlmProfile } from "./profile";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface CompletionOptions {
  /** Upper bound on generated tokens. */
  readonly maxOutputTokens?: number;
}

export interface StructuredCompletionOptions extends CompletionOptions {
  /** Name of the response format sent to the provider (letters, digits, `_` and `-`). */
  readonly name?: string;
}

/**
 * What the enclave needs from a language model. The memory layer and the policy engine depend on this interface
 * only, so they can be unit-tested with fakes.
 */
export interface LlmClient {
  /** Plain text completion. */
  complete(messages: readonly ChatMessage[], options?: CompletionOptions): Promise<string>;
  /** Completion constrained by a strict JSON schema derived from `schema`, then validated with it. */
  structuredCompletion<T>(
    schema: z.ZodType<T>,
    messages: readonly ChatMessage[],
    options?: StructuredCompletionOptions,
  ): Promise<T>;
  /** One embedding per input, in input order. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface OpenAiCompatibleClientOptions {
  /** Injected for tests; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** Retries on 429 and 5xx only. */
  readonly maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_000;
const DEFAULT_SCHEMA_NAME = "badge_response";
const ERROR_BODY_PREVIEW_CHARS = 300;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

const ChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

const EmbeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number()) })),
});

/**
 * Minimal client for an OpenAI-compatible endpoint (OpenAI, Phala Confidential AI, or the egress gateway).
 * Plain fetch keeps the dependency surface of the enclave small; only two routes are used.
 */
export class OpenAiCompatibleClient implements LlmClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly profile: LlmProfile,
    options: OpenAiCompatibleClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async complete(messages: readonly ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    return this.chat(messages, options, undefined);
  }

  async structuredCompletion<T>(
    schema: z.ZodType<T>,
    messages: readonly ChatMessage[],
    options: StructuredCompletionOptions = {},
  ): Promise<T> {
    const responseFormat = {
      type: "json_schema",
      json_schema: {
        name: options.name ?? DEFAULT_SCHEMA_NAME,
        strict: true,
        schema: toStrictJsonSchema(schema),
      },
    };
    const content = await this.chat(messages, options, responseFormat);
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (cause) {
      throw new LlmOutputError(`structured output is not valid JSON (${content.length} chars)`, { cause });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new LlmOutputError(
        `structured output does not match the schema: ${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const body: Record<string, unknown> = {
      model: this.profile.embeddingModel,
      input: texts,
      encoding_format: "float",
    };
    if (this.profile.sendEmbeddingDimensions) body["dimensions"] = this.profile.embeddingDimensions;
    const response = EmbeddingResponseSchema.safeParse(await this.post("/embeddings", body));
    if (!response.success) throw new LlmOutputError("unexpected embeddings response shape");
    const vectors = new Array<number[]>(texts.length);
    for (const item of response.data.data) vectors[item.index] = item.embedding;
    for (let i = 0; i < texts.length; i++) {
      const vector = vectors[i];
      if (!vector) throw new LlmOutputError(`embeddings response is missing input #${i}`);
      // A size mismatch would silently corrupt every similarity computed against Honcho's 384-dim index.
      if (vector.length !== this.profile.embeddingDimensions) {
        throw new LlmOutputError(
          `embedding #${i} has ${vector.length} dimensions, expected ${this.profile.embeddingDimensions}`,
        );
      }
    }
    return vectors;
  }

  private async chat(
    messages: readonly ChatMessage[],
    options: CompletionOptions,
    responseFormat: Record<string, unknown> | undefined,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.profile.chatModel,
      messages,
      reasoning_effort: this.profile.reasoningEffort,
      [this.profile.maxTokensField]: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    };
    if (responseFormat) body["response_format"] = responseFormat;
    const response = ChatResponseSchema.safeParse(await this.post("/chat/completions", body));
    if (!response.success) throw new LlmOutputError("unexpected chat completion response shape");
    const [choice] = response.data.choices;
    if (!choice) throw new LlmOutputError("chat completion returned no choice");
    if (choice.message.refusal) throw new LlmOutputError(`model refused: ${choice.message.refusal}`);
    // A truncated answer is never usable: partial JSON, or a brief cut mid-sentence.
    if (choice.finish_reason === "length") {
      throw new LlmOutputError("completion truncated by the output token limit");
    }
    const content = choice.message.content;
    if (!content) throw new LlmOutputError("chat completion returned empty content");
    return content;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.profile.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${this.profile.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        throw new LlmRequestError(
          `${this.profile.name}: POST ${path} failed (network or timeout)`,
          undefined,
          {
            cause,
          },
        );
      }
      if (response.ok) return response.json();
      const retryable = response.status === HTTP_TOO_MANY_REQUESTS || response.status >= HTTP_SERVER_ERROR;
      if (retryable && attempt < this.maxRetries) {
        await response.body?.cancel();
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      const preview = this.redact(await response.text()).slice(0, ERROR_BODY_PREVIEW_CHARS);
      throw new LlmRequestError(
        `${this.profile.name}: POST ${path} returned HTTP ${response.status}: ${preview}`,
        response.status,
      );
    }
  }

  /** Providers sometimes echo (part of) the key in auth errors: never let it reach a log line. */
  private redact(text: string): string {
    return text.split(this.profile.apiKey).join("[redacted]");
  }
}

/** Convenience factory for the enclave and scripts. */
export function createLlmClient(profile: LlmProfile, options?: OpenAiCompatibleClientOptions): LlmClient {
  return new OpenAiCompatibleClient(profile, options);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
