import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILD_VARS, PHALA_VARS, TEST_API_KEY } from "../../test/fakes";
import { parseEnvFile } from "./env-file";
import { LlmConfigError } from "./errors";
import {
  describeLlmProfile,
  loadLlmProfile,
  PHALA_DEFAULT_EMBEDDING_MODEL,
  resolveLlmProfile,
} from "./profile";

describe("resolveLlmProfile", () => {
  it("builds the build profile (OpenAI parameters, 384-dim embeddings requested explicitly)", () => {
    const profile = resolveLlmProfile(BUILD_VARS, { profile: "build" });
    expect(profile).toMatchObject({
      name: "build",
      baseUrl: "https://api.example.test/v1",
      chatModel: "chat-model",
      embeddingModel: "embed-model",
      embeddingDimensions: 384,
      sendEmbeddingDimensions: true,
      maxTokensField: "max_completion_tokens",
      reasoningEffort: "none",
    });
    expect(profile.apiKey).toBe(TEST_API_KEY);
  });

  it("defaults to the build profile", () => {
    expect(resolveLlmProfile(BUILD_VARS).name).toBe("build");
  });

  it("builds the phala profile with MiniLM by default and no dimensions field", () => {
    const profile = resolveLlmProfile(PHALA_VARS, { profile: "phala" });
    expect(profile).toMatchObject({
      name: "phala",
      chatModel: "qwen/test",
      embeddingModel: PHALA_DEFAULT_EMBEDDING_MODEL,
      sendEmbeddingDimensions: false,
      maxTokensField: "max_tokens",
    });
  });

  it("applies the chat model override", () => {
    expect(resolveLlmProfile(PHALA_VARS, { profile: "phala", chatModelOverride: "other" }).chatModel).toBe(
      "other",
    );
  });

  it("routes through the CVM egress gateway when one is configured (plain HTTP allowed there only)", () => {
    const profile = resolveLlmProfile(PHALA_VARS, {
      profile: "phala",
      gatewayUrl: "http://gateway:8080/v1/",
    });
    expect(profile.baseUrl).toBe("http://gateway:8080/v1");
    expect(profile.chatModel).toBe("qwen/test");
    expect(() => resolveLlmProfile(PHALA_VARS, { profile: "phala", gatewayUrl: "ftp://gateway" })).toThrow(
      /BADGE_LLM_GATEWAY_URL/,
    );
  });

  it("never exposes the API key when serialised or described", () => {
    const profile = resolveLlmProfile(BUILD_VARS);
    expect(JSON.stringify(profile)).not.toContain(TEST_API_KEY);
    expect(JSON.stringify({ ...profile })).not.toContain(TEST_API_KEY);
    expect(describeLlmProfile(profile)).not.toContain(TEST_API_KEY);
  });

  it("lists every missing variable without printing values", () => {
    const attempt = () => resolveLlmProfile({ BUILD_LLM_API_KEY: TEST_API_KEY }, { profile: "build" });
    expect(attempt).toThrow(LlmConfigError);
    expect(attempt).toThrow(/BUILD_LLM_BASE_URL is missing.*BUILD_LLM_MODEL is missing/);
    expect(attempt).not.toThrow(new RegExp(TEST_API_KEY));
  });

  it("rejects a non-https endpoint, an unknown profile and a different embedding size", () => {
    expect(() => resolveLlmProfile({ ...BUILD_VARS, BUILD_LLM_BASE_URL: "http://x.test/v1" })).toThrow(
      /https/,
    );
    expect(() => resolveLlmProfile(BUILD_VARS, { profile: "ollama" })).toThrow(/BADGE_LLM_PROFILE/);
    expect(() => resolveLlmProfile({ ...BUILD_VARS, BUILD_EMBEDDING_DIMENSIONS: "1536" })).toThrow(/384/);
  });
});

describe("loadLlmProfile", () => {
  it("reads the env file named by BADGE_ENV_FILE, process variables taking precedence", () => {
    const dir = mkdtempSync(join(tmpdir(), "badge-env-"));
    const file = join(dir, ".env");
    writeFileSync(
      file,
      Object.entries(PHALA_VARS)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
    );
    const profile = loadLlmProfile({
      BADGE_ENV_FILE: file,
      BADGE_LLM_PROFILE: "phala",
      PHALA_AI_MODEL: "from-env",
    });
    expect(profile.chatModel).toBe("from-env");
    expect(profile.baseUrl).toBe(PHALA_VARS.PHALA_AI_BASE_URL);
  });
});

describe("parseEnvFile", () => {
  it("parses KEY=VALUE lines, strips quotes, skips comments and keeps '=' inside values", () => {
    const vars = parseEnvFile("# comment\n\nA=1\nexport B=\"two words\"\nC='x=y'\nnot a line\n");
    expect(vars).toEqual({ A: "1", B: "two words", C: "x=y" });
  });
});
