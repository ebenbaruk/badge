/**
 * Server configuration, read once from the environment and validated (fail fast on a typo, not mid-demo).
 */
import { resolve } from "node:path";
import { z } from "zod";
import type { EmployeeId } from "@/lib/directory";
import { ConfigError } from "./errors";

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;
const COMPOSE_HASH_HEX = /^(0x)?[0-9a-fA-F]{64}$/;
const DEFAULT_ENCLAVE_URL = "http://127.0.0.1:8787";
const DEFAULT_DATA_DIR = ".data";

const envSchema = z
  .object({
    /** `live` (default): the real enclave through @badge/client. `mock`: in-memory enclave for UI work only. */
    BADGE_ENCLAVE_MODE: z.enum(["mock", "live"]).default("live"),
    BADGE_ENCLAVE_URL: z.url().default(DEFAULT_ENCLAVE_URL),
    /**
     * How the enclave quote is verified. `simulated` accepts the dstack simulator (shown amber in the UI, never as a
     * real TEE); `tdx` requires a genuine Intel TDX quote whose compose hash equals BADGE_ENCLAVE_COMPOSE_HASH.
     */
    BADGE_ATTESTATION_MODE: z.enum(["simulated", "tdx"]).default("simulated"),
    BADGE_ENCLAVE_COMPOSE_HASH: z.string().regex(COMPOSE_HASH_HEX).optional(),
    BADGE_SPECULOS_ALICE: z.url().default("http://localhost:5001"),
    BADGE_SPECULOS_BOB: z.url().default("http://localhost:5002"),
    BADGE_SPECULOS_CHLOE: z.url().default("http://localhost:5003"),
    /** Test CAL key (PEM) used to sign the clear-signing filters; bundled code cannot rely on the package default. */
    BADGE_CAL_TEST_KEY: z.string().min(1).optional(),
    /**
     * Where the agent runtime keeps its owner-only state (session keys, task ids) across restarts. Defaults to
     * `.data` in the working directory (apps/web under `pnpm --filter @badge/web dev`), which git ignores.
     */
    BADGE_WEB_DATA_DIR: z.string().min(1).default(DEFAULT_DATA_DIR),
    /** Overrides the measurement the mock enclave pins messages to (e.g. the dstack simulator's compose hash). */
    BADGE_MOCK_MEASUREMENT: z.string().regex(BYTES32_HEX).optional(),
  })
  // Pinning is what makes a TDX quote meaningful: without it, any genuine CVM running any code would be accepted.
  .refine((env) => env.BADGE_ATTESTATION_MODE !== "tdx" || env.BADGE_ENCLAVE_COMPOSE_HASH !== undefined, {
    error: "BADGE_ATTESTATION_MODE=tdx requires BADGE_ENCLAVE_COMPOSE_HASH (the compose hash to pin)",
    path: ["BADGE_ENCLAVE_COMPOSE_HASH"],
  });

export interface LiveEnclaveConfig {
  baseUrl: string;
  attestationMode: "simulated" | "tdx";
  /** Compose hash (hex, no prefix) the TDX quote must match; undefined in simulated mode. */
  expectedComposeHash: string | undefined;
  /** Absolute directory of the agent runtime's persisted state. */
  dataDir: string;
}

export interface ServerConfig {
  enclaveMode: "mock" | "live";
  live: LiveEnclaveConfig;
  speculosUrls: Readonly<Record<EmployeeId, string>>;
  calTestKeyPath: string | undefined;
  mockMeasurement: `0x${string}` | undefined;
}

let cached: ServerConfig | undefined;

/** @throws ConfigError when an environment variable is malformed. */
export function serverConfig(): ServerConfig {
  if (cached !== undefined) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) throw new ConfigError(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  const env = parsed.data;
  cached = {
    enclaveMode: env.BADGE_ENCLAVE_MODE,
    live: {
      baseUrl: env.BADGE_ENCLAVE_URL,
      attestationMode: env.BADGE_ATTESTATION_MODE,
      expectedComposeHash: env.BADGE_ENCLAVE_COMPOSE_HASH?.replace(/^0x/, "").toLowerCase(),
      dataDir: resolve(env.BADGE_WEB_DATA_DIR),
    },
    speculosUrls: {
      alice: env.BADGE_SPECULOS_ALICE,
      bob: env.BADGE_SPECULOS_BOB,
      chloe: env.BADGE_SPECULOS_CHLOE,
    },
    calTestKeyPath: env.BADGE_CAL_TEST_KEY,
    mockMeasurement: env.BADGE_MOCK_MEASUREMENT as `0x${string}` | undefined,
  };
  return cached;
}
