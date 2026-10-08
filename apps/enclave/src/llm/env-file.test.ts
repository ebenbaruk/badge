import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENV_FILE, REPO_ENV_FILE, resolveEnvFilePath } from "./env-file";

describe("resolveEnvFilePath", () => {
  it("prefers BADGE_ENV_FILE, resolved from the cwd", () => {
    expect(resolveEnvFilePath({ BADGE_ENV_FILE: "secrets/.env" }, () => true)).toBe(resolve("secrets/.env"));
  });

  it("uses the repository-root .env when it exists", () => {
    expect(resolveEnvFilePath({}, (path) => path === REPO_ENV_FILE)).toBe(REPO_ENV_FILE);
  });

  it("falls back to the .env next to the repository", () => {
    expect(resolveEnvFilePath({}, () => false)).toBe(DEFAULT_ENV_FILE);
  });
});
