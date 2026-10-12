/**
 * Enclave server configuration from the environment, validated once at startup. Secrets (LLM keys, Honcho admin
 * JWT) are not read here: their own loaders (src/llm, src/memory) handle them and never log them.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "./llm/env-file";
import { SEED_DATASET_PATH } from "./memory/seed-dataset";

export const DEFAULT_ENCLAVE_PORT = 8787;
/** Loopback by default: the CVM's compose file sets 0.0.0.0 explicitly behind the dstack gateway. */
export const DEFAULT_ENCLAVE_HOST = "127.0.0.1";
export const DEFAULT_DATA_DIR = resolve(REPO_ROOT, "infra/.data/enclave");
export const DATABASE_FILE_NAME = "enclave.sqlite";
/** Socket of the dstack guest agent inside a CVM. */
export const DSTACK_SOCKET_PATH = "/var/run/dstack.sock";
/** infra/dstack-sim.sh listens here. */
export const DEFAULT_DSTACK_SIMULATOR_ENDPOINT = "http://127.0.0.1:8090";

const EnvSchema = z.object({
  BADGE_DATA_DIR: z.string().min(1).default(DEFAULT_DATA_DIR),
  BADGE_ENCLAVE_PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_ENCLAVE_PORT),
  BADGE_ENCLAVE_HOST: z.string().min(1).default(DEFAULT_ENCLAVE_HOST),
  BADGE_SEED_FILE: z.string().min(1).default(SEED_DATASET_PATH),
  DSTACK_SIMULATOR_ENDPOINT: z.url().optional(),
  /** "false" lets local tools call /v1 over plain HTTP; forced to true inside a CVM. */
  BADGE_REQUIRE_CHANNEL: z.enum(["true", "false"]).default("true"),
});

export interface EnclaveConfig {
  readonly databasePath: string;
  readonly port: number;
  readonly host: string;
  readonly seedFile: string;
  /** undefined = the CVM socket; otherwise the simulator URL (local development only). */
  readonly dstackEndpoint: string | undefined;
  readonly simulated: boolean;
  /** Only the attested channel reaches /v1 (always true in a CVM). */
  readonly requireChannel: boolean;
}

/** Thrown when the environment is invalid; the message names the variable. */
export class EnclaveConfigError extends Error {
  override readonly name = "EnclaveConfigError";
}

/**
 * Reads the configuration. In a CVM (dstack socket present) the simulator is never used, even if the variable is
 * set: a production enclave must not take its measurement from a simulator.
 */
export function loadEnclaveConfig(
  env: NodeJS.ProcessEnv = process.env,
  socketExists: (path: string) => boolean = existsSync,
): EnclaveConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success)
    throw new EnclaveConfigError(`invalid enclave environment: ${z.prettifyError(parsed.error)}`);
  const vars = parsed.data;
  const inCvm = socketExists(DSTACK_SOCKET_PATH);
  const requireChannel = vars.BADGE_REQUIRE_CHANNEL === "true";
  // On Phala, TLS ends at the gateway: a plain-HTTP enclave would expose every request to the operator.
  if (inCvm && !requireChannel) {
    throw new EnclaveConfigError("BADGE_REQUIRE_CHANNEL=false is refused inside a CVM");
  }
  return {
    databasePath: join(vars.BADGE_DATA_DIR, DATABASE_FILE_NAME),
    port: vars.BADGE_ENCLAVE_PORT,
    host: vars.BADGE_ENCLAVE_HOST,
    seedFile: vars.BADGE_SEED_FILE,
    dstackEndpoint: inCvm ? undefined : (vars.DSTACK_SIMULATOR_ENDPOINT ?? DEFAULT_DSTACK_SIMULATOR_ENDPOINT),
    simulated: !inCvm,
    requireChannel,
  };
}
