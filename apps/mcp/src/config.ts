/**
 * MCP server configuration from the environment and the command line, validated once at startup.
 * The session key itself is not read here (see session-file.ts): this module only knows its path.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AttestationMode } from "@badge/attest";
import { BadgeApiError, enclavePinsFromEnv, type EnclavePins } from "@badge/client";
import { z } from "zod";
import { McpSetupError } from "./errors";

/** apps/enclave's default listen address. */
export const DEFAULT_ENCLAVE_URL = "http://127.0.0.1:8787";
/** Next to the enclave (8787) and the dstack simulator (8090). */
export const DEFAULT_MCP_HTTP_PORT = 8790;
/**
 * The HTTP endpoint has no authentication of its own: whoever reaches it acts as the employee. It therefore only
 * ever listens on the loopback interface, like a stdio server only ever talks to its parent process.
 */
export const MCP_HTTP_HOST = "127.0.0.1";
export const MCP_HTTP_PATH = "/mcp";

const EnvSchema = z
  .object({
    BADGE_ENCLAVE_URL: z.url({ protocol: /^https?$/ }).default(DEFAULT_ENCLAVE_URL),
    BADGE_SESSION_KEY_FILE: z.string().min(1).optional(),
    BADGE_ENCLAVE_TRANSPORT: z.enum(["channel", "plain"]).default("channel"),
    // Fail closed: the real-TEE checks apply unless the simulator is chosen explicitly.
    BADGE_ATTESTATION_MODE: z.enum(["tdx", "simulated"]).default("tdx"),
    BADGE_MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
    BADGE_MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_MCP_HTTP_PORT),
  })
  .refine((env) => env.BADGE_ENCLAVE_TRANSPORT !== "plain" || env.BADGE_ATTESTATION_MODE === "simulated", {
    message: "the plain transport skips attestation: only allowed with BADGE_ATTESTATION_MODE=simulated",
    path: ["BADGE_ENCLAVE_TRANSPORT"],
  });

/** What every enclave client needs (MCP server and session CLI). */
export interface EnclaveConfig {
  readonly enclaveUrl: string;
  readonly enclaveTransport: "channel" | "plain";
  readonly attestationMode: AttestationMode;
  /**
   * What the quote must match (BADGE_ENCLAVE_COMPOSE_HASH, BADGE_ENCLAVE_APP_ID, BADGE_ENCLAVE_OS_MEASUREMENTS_FILE):
   * compose hash, app id and OS measurements are all mandatory in tdx mode, or any deployment would be trusted.
   */
  readonly pins: EnclavePins;
}

export interface McpConfig extends EnclaveConfig {
  readonly sessionFile: string;
  readonly mcpTransport: "stdio" | "http";
  readonly httpPort: number;
}

/** Reads a pins file (relative paths from the working directory). */
export type ReadFile = (path: string) => string;
const readUtf8: ReadFile = (path) => readFileSync(resolve(path), "utf8");

function parseEnv(env: NodeJS.ProcessEnv): z.infer<typeof EnvSchema> {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new McpSetupError("CONFIG_INVALID", `invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function enclaveConfigOf(
  vars: z.infer<typeof EnvSchema>,
  env: NodeJS.ProcessEnv,
  readFile: ReadFile,
): EnclaveConfig {
  let pins: EnclavePins;
  try {
    pins = enclavePinsFromEnv(env, vars.BADGE_ATTESTATION_MODE, readFile);
  } catch (error) {
    if (!(error instanceof BadgeApiError)) throw error;
    throw new McpSetupError("CONFIG_INVALID", `invalid configuration: ${error.message}`, { cause: error });
  }
  return {
    enclaveUrl: vars.BADGE_ENCLAVE_URL,
    enclaveTransport: vars.BADGE_ENCLAVE_TRANSPORT,
    attestationMode: vars.BADGE_ATTESTATION_MODE,
    pins,
  };
}

/**
 * Reads only the enclave connection settings (session CLI).
 * @throws McpSetupError("CONFIG_INVALID").
 */
export function loadEnclaveConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: ReadFile = readUtf8,
): EnclaveConfig {
  return enclaveConfigOf(parseEnv(env), env, readFile);
}

/**
 * Reads the configuration. Command-line flags (`--session <file>`, `--http`, `--port <n>`) override the
 * environment, so one harness config can point several agents at different session files.
 * @throws McpSetupError("CONFIG_INVALID") naming the offending variable.
 */
export function loadMcpConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
  readFile: ReadFile = readUtf8,
): McpConfig {
  let flags: { session?: string; http?: boolean; port?: string };
  try {
    flags = parseArgs({
      args: argv,
      options: { session: { type: "string" }, http: { type: "boolean" }, port: { type: "string" } },
      strict: true,
    }).values;
  } catch (error) {
    throw new McpSetupError("CONFIG_INVALID", (error as Error).message, { cause: error });
  }
  const vars = parseEnv({
    ...env,
    ...(flags.session === undefined ? {} : { BADGE_SESSION_KEY_FILE: flags.session }),
    ...(flags.http === true ? { BADGE_MCP_TRANSPORT: "http" } : {}),
    ...(flags.port === undefined ? {} : { BADGE_MCP_HTTP_PORT: flags.port }),
  });
  if (vars.BADGE_SESSION_KEY_FILE === undefined) {
    throw new McpSetupError(
      "CONFIG_INVALID",
      "no session file: set BADGE_SESSION_KEY_FILE or pass --session <file> (see `pnpm --filter @badge/mcp session create`)",
    );
  }
  return {
    ...enclaveConfigOf(vars, env, readFile),
    sessionFile: vars.BADGE_SESSION_KEY_FILE,
    mcpTransport: vars.BADGE_MCP_TRANSPORT,
    httpPort: vars.BADGE_MCP_HTTP_PORT,
  };
}
