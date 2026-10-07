/**
 * MCP server configuration from the environment and the command line, validated once at startup.
 * The session key itself is not read here (see session-file.ts): this module only knows its path.
 */
import { parseArgs } from "node:util";
import type { AttestationMode } from "@badge/attest";
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

const COMPOSE_HASH_HEX = /^(0x)?[0-9a-fA-F]{64}$/;

const EnvSchema = z
  .object({
    BADGE_ENCLAVE_URL: z.url({ protocol: /^https?$/ }).default(DEFAULT_ENCLAVE_URL),
    BADGE_SESSION_KEY_FILE: z.string().min(1).optional(),
    BADGE_ENCLAVE_TRANSPORT: z.enum(["channel", "plain"]).default("channel"),
    // Fail closed: the real-TEE checks apply unless the simulator is chosen explicitly.
    BADGE_ATTESTATION_MODE: z.enum(["tdx", "simulated"]).default("tdx"),
    BADGE_ENCLAVE_COMPOSE_HASH: z
      .string()
      .regex(COMPOSE_HASH_HEX, { error: "must be 32 bytes of hex" })
      .optional(),
    BADGE_MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
    BADGE_MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_MCP_HTTP_PORT),
  })
  .refine((env) => env.BADGE_ATTESTATION_MODE !== "tdx" || env.BADGE_ENCLAVE_COMPOSE_HASH !== undefined, {
    message:
      "BADGE_ENCLAVE_COMPOSE_HASH is mandatory in tdx mode: without it any deployment would be trusted",
    path: ["BADGE_ENCLAVE_COMPOSE_HASH"],
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
  readonly expectedComposeHash: string | undefined;
}

export interface McpConfig extends EnclaveConfig {
  readonly sessionFile: string;
  readonly mcpTransport: "stdio" | "http";
  readonly httpPort: number;
}

function parseEnv(env: NodeJS.ProcessEnv): z.infer<typeof EnvSchema> {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new McpSetupError("config_invalid", `invalid configuration: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function enclaveConfigOf(vars: z.infer<typeof EnvSchema>): EnclaveConfig {
  return {
    enclaveUrl: vars.BADGE_ENCLAVE_URL,
    enclaveTransport: vars.BADGE_ENCLAVE_TRANSPORT,
    attestationMode: vars.BADGE_ATTESTATION_MODE,
    expectedComposeHash: vars.BADGE_ENCLAVE_COMPOSE_HASH,
  };
}

/**
 * Reads only the enclave connection settings (session CLI).
 * @throws McpSetupError("config_invalid").
 */
export function loadEnclaveConfig(env: NodeJS.ProcessEnv = process.env): EnclaveConfig {
  return enclaveConfigOf(parseEnv(env));
}

/**
 * Reads the configuration. Command-line flags (`--session <file>`, `--http`, `--port <n>`) override the
 * environment, so one harness config can point several agents at different session files.
 * @throws McpSetupError("config_invalid") naming the offending variable.
 */
export function loadMcpConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): McpConfig {
  let flags: { session?: string; http?: boolean; port?: string };
  try {
    flags = parseArgs({
      args: argv,
      options: { session: { type: "string" }, http: { type: "boolean" }, port: { type: "string" } },
      strict: true,
    }).values;
  } catch (error) {
    throw new McpSetupError("config_invalid", (error as Error).message, { cause: error });
  }
  const vars = parseEnv({
    ...env,
    ...(flags.session === undefined ? {} : { BADGE_SESSION_KEY_FILE: flags.session }),
    ...(flags.http === true ? { BADGE_MCP_TRANSPORT: "http" } : {}),
    ...(flags.port === undefined ? {} : { BADGE_MCP_HTTP_PORT: flags.port }),
  });
  if (vars.BADGE_SESSION_KEY_FILE === undefined) {
    throw new McpSetupError(
      "config_invalid",
      "no session file: set BADGE_SESSION_KEY_FILE or pass --session <file> (see `pnpm --filter @badge/mcp session create`)",
    );
  }
  return {
    ...enclaveConfigOf(vars),
    sessionFile: vars.BADGE_SESSION_KEY_FILE,
    mcpTransport: vars.BADGE_MCP_TRANSPORT,
    httpPort: vars.BADGE_MCP_HTTP_PORT,
  };
}
