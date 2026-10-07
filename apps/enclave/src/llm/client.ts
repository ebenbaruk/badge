import { z } from "zod";
import { LlmOutputError, LlmRequestError, type LlmOutputFailure } from "./errors";
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
  /** Retries of one HTTP request on 429, 5xx and network errors (never on a timeout or another 4xx). */
  readonly maxRetries?: number;
  /**
   * New samples drawn when a structured answer is unusable (invalid JSON, schema mismatch, truncated, empty).
   * Sampling is not deterministic: on a real provider a small share of answers is malformed, and a task runs one
   * classification per candidate excerpt in parallel, so without this one bad sample fails the whole request.
   */
  readonly maxOutputRetries?: number;
  /** Injected for tests; defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_OUTPUT_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 500;
/** Upper bound on a provider's Retry-After: the caller is an agent waiting on an interactive request. */
const MAX_RETRY_AFTER_MS = 5_000;
const MS_PER_SECOND = 1_000;
/** Failures a new sample can fix; a refusal or a malformed envelope will not change on a retry. */
const RESAMPLED_FAILURES: ReadonlySet<LlmOutputFailure> = new Set([
  "invalid_json",
  "schema_mismatch",
  "truncated",
  "empty",
]);
const DEFAULT_MAX_OUTPUT_TOKENS = 1_000;
const DEFAULT_SCHEMA_NAME = "badge_response";
/** Names the call in diagnostics: the schema name for structured outputs, these for the other two. */
const COMPLETION_CALL = "completion";
const EMBEDDINGS_CALL = "embeddings";
const MAX_LOGGED_SCHEMA_ISSUES = 5;
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

/** The content-free fields of an OpenAI-style error body (`message` is left out: it may echo the request). */
const ProviderErrorSchema = z.object({
  error: z
    .object({
      type: z.string().nullish(),
      code: z.union([z.string(), z.number()]).nullish(),
      param: z.string().nullish(),
    })
    .optional(),
  type: z.string().nullish(),
  code: z.union([z.string(), z.number()]).nullish(),
  param: z.string().nullish(),
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
  private readonly maxOutputRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly profile: LlmProfile,
    options: OpenAiCompatibleClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxOutputRetries = options.maxOutputRetries ?? DEFAULT_MAX_OUTPUT_RETRIES;
    this.sleep = options.sleep ?? delay;
  }

  async complete(messages: readonly ChatMessage[], options: CompletionOptions = {}): Promise<string> {
    return this.chat(messages, options, undefined, COMPLETION_CALL);
  }

  async structuredCompletion<T>(
    schema: z.ZodType<T>,
    messages: readonly ChatMessage[],
    options: StructuredCompletionOptions = {},
  ): Promise<T> {
    const name = options.name ?? DEFAULT_SCHEMA_NAME;
    const responseFormat = {
      type: "json_schema",
      json_schema: { name, strict: true, schema: toStrictJsonSchema(schema) },
    };
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.structuredAttempt(schema, messages, options, responseFormat, name);
      } catch (error) {
        const resample =
          error instanceof LlmOutputError &&
          RESAMPLED_FAILURES.has(error.failure) &&
          attempt < this.maxOutputRetries;
        if (!resample) throw error;
      }
    }
  }

  private async structuredAttempt<T>(
    schema: z.ZodType<T>,
    messages: readonly ChatMessage[],
    options: CompletionOptions,
    responseFormat: Record<string, unknown>,
    name: string,
  ): Promise<T> {
    const content = await this.chat(messages, options, responseFormat, name);
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (cause) {
      throw outputError(
        name,
        "invalid_json",
        `structured output is not valid JSON (${content.length} chars)`,
        `${content.length} chars`,
        { cause },
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw outputError(
        name,
        "schema_mismatch",
        `structured output does not match the schema: ${z.prettifyError(parsed.error)}`,
        describeIssues(parsed.error),
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
    const response = EmbeddingResponseSchema.safeParse(await this.post("/embeddings", body, EMBEDDINGS_CALL));
    if (!response.success) {
      throw outputError(EMBEDDINGS_CALL, "bad_response_shape", "unexpected embeddings response shape");
    }
    const vectors = new Array<number[]>(texts.length);
    for (const item of response.data.data) vectors[item.index] = item.embedding;
    for (let i = 0; i < texts.length; i++) {
      const vector = vectors[i];
      if (!vector) {
        const message = `embeddings response is missing input #${i}`;
        throw outputError(EMBEDDINGS_CALL, "missing_embedding", message, `input #${i} of ${texts.length}`);
      }
      // A size mismatch would silently corrupt every similarity computed against Honcho's 384-dim index.
      if (vector.length !== this.profile.embeddingDimensions) {
        const sizes = `${vector.length} dimensions, expected ${this.profile.embeddingDimensions}`;
        throw outputError(EMBEDDINGS_CALL, "wrong_dimensions", `embedding #${i} has ${sizes}`, sizes);
      }
    }
    return vectors;
  }

  private async chat(
    messages: readonly ChatMessage[],
    options: CompletionOptions,
    responseFormat: Record<string, unknown> | undefined,
    call: string,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.profile.chatModel,
      messages,
      reasoning_effort: this.profile.reasoningEffort,
      [this.profile.maxTokensField]: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    };
    if (responseFormat) body["response_format"] = responseFormat;
    const response = ChatResponseSchema.safeParse(await this.post("/chat/completions", body, call));
    if (!response.success) {
      throw outputError(call, "bad_response_shape", "unexpected chat completion response shape");
    }
    const [choice] = response.data.choices;
    if (!choice) throw outputError(call, "no_choice", "chat completion returned no choice");
    if (choice.message.refusal) {
      throw outputError(call, "refused", `model refused: ${choice.message.refusal}`);
    }
    // A truncated answer is never usable: partial JSON, or a brief cut mid-sentence.
    if (choice.finish_reason === "length") {
      throw outputError(
        call,
        "truncated",
        "completion truncated by the output token limit",
        `limit ${String(body[this.profile.maxTokensField])} tokens`,
      );
    }
    const content = choice.message.content;
    if (!content) throw outputError(call, "empty", "chat completion returned empty content");
    return content;
  }

  private async post(path: string, body: Record<string, unknown>, call: string): Promise<unknown> {
    const url = `${this.profile.baseUrl}${path}`;
    const route = `POST ${path} [${call}]`;
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
        const timedOut = cause instanceof Error && cause.name === "TimeoutError";
        // A reset or refused connection is worth one more try; a timeout already cost the agent a minute.
        if (!timedOut && attempt < this.maxRetries) {
          await this.sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        throw new LlmRequestError(
          `${this.profile.name}: POST ${path} failed (network or timeout)`,
          undefined,
          timedOut
            ? `${route}: timed out after ${this.timeoutMs} ms`
            : `${route}: network error after ${attempt + 1} attempt(s) (${describeNetworkError(cause)})`,
          { cause },
        );
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch (cause) {
          // A proxy page or a cut stream: not an answer, and not an internal error of the enclave either.
          throw outputError(call, "bad_response_shape", `POST ${path} returned a non-JSON body`, undefined, {
            cause,
          });
        }
      }
      const retryable = response.status === HTTP_TOO_MANY_REQUESTS || response.status >= HTTP_SERVER_ERROR;
      if (retryable && attempt < this.maxRetries) {
        const backoffMs = retryAfterMs(response) ?? RETRY_BASE_DELAY_MS * 2 ** attempt;
        await response.body?.cancel();
        await this.sleep(backoffMs);
        continue;
      }
      const text = await response.text();
      const preview = this.redact(text).slice(0, ERROR_BODY_PREVIEW_CHARS);
      throw new LlmRequestError(
        `${this.profile.name}: POST ${path} returned HTTP ${response.status}: ${preview}`,
        response.status,
        `${route}: HTTP ${response.status} after ${attempt + 1} attempt(s)${describeProviderError(text)}`,
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

function outputError(
  call: string,
  failure: LlmOutputFailure,
  message: string,
  detail?: string,
  options?: ErrorOptions,
): LlmOutputError {
  return new LlmOutputError(message, failure, `${call}: ${failure}${detail ? ` (${detail})` : ""}`, options);
}

/** The provider's Retry-After in seconds (rate limits), capped; undefined when absent or not a number of seconds. */
function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(seconds * MS_PER_SECOND, MAX_RETRY_AFTER_MS);
}

/** Paths and codes of the failed checks, never the values (they are model output, i.e. excerpt text). */
function describeIssues(error: z.ZodError): string {
  const issues = error.issues
    .slice(0, MAX_LOGGED_SCHEMA_ISSUES)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`);
  const more = error.issues.length - issues.length;
  return more > 0 ? `${issues.join(", ")} and ${more} more` : issues.join(", ");
}

/** The provider's error type, code and parameter, when the body is an OpenAI-style error. */
function describeProviderError(text: string): string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return ", non-JSON body";
  }
  const parsed = ProviderErrorSchema.safeParse(json);
  if (!parsed.success) return "";
  const fields = { ...parsed.data, ...parsed.data.error };
  const parts = [
    fields.type ? `type ${fields.type}` : "",
    fields.code !== undefined && fields.code !== null ? `code ${fields.code}` : "",
    fields.param ? `param ${fields.param}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `, ${parts.join(", ")}` : "";
}

/** undici reports the system error (ECONNREFUSED, ENOTFOUND...) as the cause of "fetch failed". */
function describeNetworkError(cause: unknown): string {
  if (!(cause instanceof Error)) return typeof cause;
  const inner: unknown = cause.cause;
  const code =
    typeof inner === "object" && inner !== null && "code" in inner && typeof inner.code === "string"
      ? inner.code
      : undefined;
  return code ? `${cause.name}, ${code}` : cause.name;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
