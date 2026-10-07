import { z } from "zod";
import { readEnvFile, resolveEnvFilePath } from "./env-file";
import { LlmConfigError } from "./errors";

export const LLM_PROFILE_NAMES = ["build", "phala"] as const;
export type LlmProfileName = (typeof LLM_PROFILE_NAMES)[number];
export const DEFAULT_LLM_PROFILE: LlmProfileName = "build";

/**
 * Honcho's pgvector columns are sized once, at first boot. Both profiles must produce vectors of this size so that
 * switching profile only requires re-indexing, never a schema change.
 */
export const EMBEDDING_DIMENSIONS = 384;

/** Phala serves MiniLM under its sentence-transformers id (natively 384-dimensional). */
export const PHALA_DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-minilm-l6-v2";

/**
 * Honcho's dialectic and our structured calls need instruct behaviour: a reasoning model either leaks its
 * reasoning into `content` or spends the output budget on it. "none" is accepted by OpenAI gpt-6 and by Phala's
 * Qwen models ("minimal" is rejected by OpenAI).
 */
export const REASONING_EFFORT = "none";

/** One OpenAI-compatible endpoint with its models. The API key is non-enumerable so it never shows up in logs. */
export interface LlmProfile {
  readonly name: LlmProfileName;
  /** Base URL including the version segment, without trailing slash (e.g. https://api.openai.com/v1). */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  /** OpenAI text-embedding-3 models are shortened on request; MiniLM has a fixed size and must not get the field. */
  readonly sendEmbeddingDimensions: boolean;
  /** OpenAI's recent models reject `max_tokens`; most other OpenAI-compatible servers only know `max_tokens`. */
  readonly maxTokensField: "max_completion_tokens" | "max_tokens";
  readonly reasoningEffort: typeof REASONING_EFFORT;
}

const nonEmpty = (name: string) =>
  z
    .string({ error: `${name} is missing` })
    .trim()
    .min(1, `${name} is empty`);
const httpsUrl = (name: string) =>
  nonEmpty(name)
    .pipe(z.url({ protocol: /^https$/, error: `${name} must be an https URL` }))
    .transform((url) => url.replace(/\/+$/, ""));

const BuildVarsSchema = z.object({
  BUILD_LLM_BASE_URL: httpsUrl("BUILD_LLM_BASE_URL"),
  BUILD_LLM_API_KEY: nonEmpty("BUILD_LLM_API_KEY"),
  BUILD_LLM_MODEL: nonEmpty("BUILD_LLM_MODEL"),
  BUILD_EMBEDDING_MODEL: nonEmpty("BUILD_EMBEDDING_MODEL"),
  BUILD_EMBEDDING_DIMENSIONS: z.coerce
    .number({ error: "BUILD_EMBEDDING_DIMENSIONS must be a number" })
    .refine((dims) => dims === EMBEDDING_DIMENSIONS, {
      error: `BUILD_EMBEDDING_DIMENSIONS must be ${EMBEDDING_DIMENSIONS} (schema shared with the phala profile)`,
    }),
});

const PhalaVarsSchema = z.object({
  PHALA_AI_BASE_URL: httpsUrl("PHALA_AI_BASE_URL"),
  PHALA_AI_API_KEY: nonEmpty("PHALA_AI_API_KEY"),
  PHALA_AI_MODEL: nonEmpty("PHALA_AI_MODEL"),
  PHALA_AI_EMBEDDING_MODEL: z.string().trim().min(1).default(PHALA_DEFAULT_EMBEDDING_MODEL),
});

const ProfileNameSchema = z.enum(LLM_PROFILE_NAMES, {
  error: `BADGE_LLM_PROFILE must be one of: ${LLM_PROFILE_NAMES.join(", ")}`,
});

/** Variables that select or tweak a profile (never secrets). */
export interface ProfileSelection {
  readonly profile?: string | undefined;
  /** Optional chat model override (BADGE_LLM_CHAT_MODEL), e.g. to try another Phala model without editing secrets. */
  readonly chatModelOverride?: string | undefined;
}

/**
 * Builds a profile from a flat variable map (pure: no file or process access, so it is unit-testable).
 * @throws {LlmConfigError} listing every missing or invalid variable, never their values.
 */
export function resolveLlmProfile(
  vars: Readonly<Record<string, string | undefined>>,
  selection: ProfileSelection = {},
): LlmProfile {
  const nameResult = ProfileNameSchema.safeParse(selection.profile ?? DEFAULT_LLM_PROFILE);
  if (!nameResult.success) throw new LlmConfigError(formatIssues(nameResult.error));
  const name = nameResult.data;
  const override = selection.chatModelOverride?.trim() || undefined;

  if (name === "build") {
    const parsed = BuildVarsSchema.safeParse(vars);
    if (!parsed.success) throw new LlmConfigError(`LLM profile "build": ${formatIssues(parsed.error)}`);
    const v = parsed.data;
    return withHiddenKey({
      name,
      baseUrl: v.BUILD_LLM_BASE_URL,
      apiKey: v.BUILD_LLM_API_KEY,
      chatModel: override ?? v.BUILD_LLM_MODEL,
      embeddingModel: v.BUILD_EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
      sendEmbeddingDimensions: true,
      maxTokensField: "max_completion_tokens",
      reasoningEffort: REASONING_EFFORT,
    });
  }

  const parsed = PhalaVarsSchema.safeParse(vars);
  if (!parsed.success) throw new LlmConfigError(`LLM profile "phala": ${formatIssues(parsed.error)}`);
  const v = parsed.data;
  return withHiddenKey({
    name,
    baseUrl: v.PHALA_AI_BASE_URL,
    apiKey: v.PHALA_AI_API_KEY,
    chatModel: override ?? v.PHALA_AI_MODEL,
    embeddingModel: v.PHALA_AI_EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    sendEmbeddingDimensions: false,
    maxTokensField: "max_tokens",
    reasoningEffort: REASONING_EFFORT,
  });
}

/**
 * Loads the profile selected by BADGE_LLM_PROFILE (default "build") from the secrets file (BADGE_ENV_FILE, default
 * `<repo>/../.env`). Process environment variables take precedence over the file, so the enclave container can
 * inject them directly.
 * @throws {LlmConfigError} when the profile is unknown or incomplete.
 */
export function loadLlmProfile(env: NodeJS.ProcessEnv = process.env): LlmProfile {
  const fileVars = readEnvFile(resolveEnvFilePath(env));
  const vars: Record<string, string | undefined> = { ...fileVars };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== "") vars[key] = value;
  }
  return resolveLlmProfile(vars, {
    profile: env["BADGE_LLM_PROFILE"],
    chatModelOverride: env["BADGE_LLM_CHAT_MODEL"],
  });
}

/** A loggable view of a profile (everything but the key). */
export function describeLlmProfile(profile: LlmProfile): string {
  return `${profile.name} (${profile.baseUrl}, chat ${profile.chatModel}, embeddings ${profile.embeddingModel}/${profile.embeddingDimensions})`;
}

function withHiddenKey(profile: LlmProfile): LlmProfile {
  const { apiKey, ...visible } = profile;
  const result = { ...visible } as LlmProfile;
  // Non-enumerable: JSON.stringify, console.log and object spreads of the profile never carry the key.
  Object.defineProperty(result, "apiKey", { value: apiKey, enumerable: false });
  return Object.freeze(result);
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}
