import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, resolved from this file (apps/enclave/src/llm) so it does not depend on the cwd. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Default secrets file: one level above the repository, so it can never be committed by accident.
 * Override with BADGE_ENV_FILE.
 */
export const DEFAULT_ENV_FILE = resolve(REPO_ROOT, "../.env");

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/**
 * Parses dotenv-style `KEY=VALUE` lines. Comments and blank lines are skipped; surrounding single or double
 * quotes are removed. No interpolation and no multi-line values: the secrets file stays a plain list.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = ENV_LINE.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    vars[key] = unquote(rawValue);
  }
  return vars;
}

function unquote(value: string): string {
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Reads the secrets file if it exists. A missing file is not an error by itself: inside the enclave container
 * the same variables may come from the environment instead. Missing variables are reported by the profile loader.
 */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

/** Resolves the secrets file path: BADGE_ENV_FILE (absolute or relative to the cwd), else {@link DEFAULT_ENV_FILE}. */
export function resolveEnvFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["BADGE_ENV_FILE"];
  return configured ? resolve(configured) : DEFAULT_ENV_FILE;
}
