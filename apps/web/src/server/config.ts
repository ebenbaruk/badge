/**
 * Server configuration, read once from the environment and validated (fail fast on a typo, not mid-demo).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BadgeApiError, enclavePinsFromEnv, type EnclavePins } from "@badge/client";
import { z } from "zod";
import type { EmployeeId } from "@/lib/directory";
import { ConfigError } from "./errors";

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_ENCLAVE_URL = "http://127.0.0.1:8787";
const DEFAULT_DATA_DIR = ".data";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "[::1]"]);
const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

/** True for an enclave on this machine, the only place where the dstack simulator may stand in for a TEE. */
export function isLoopbackUrl(url: string): boolean {
  const { hostname } = new URL(url);
  return LOOPBACK_HOSTNAMES.has(hostname) || IPV4_LOOPBACK.test(hostname);
}

const envSchema = z.object({
  /** `live` (default): the real enclave through @badge/client. `mock`: in-memory enclave for UI work only. */
  BADGE_ENCLAVE_MODE: z.enum(["mock", "live"]).default("live"),
  BADGE_ENCLAVE_URL: z.url().default(DEFAULT_ENCLAVE_URL),
  /**
   * How the enclave quote is verified. `simulated` accepts the dstack simulator (shown amber in the UI, never as a
   * real TEE) and is only allowed, and the default, for a loopback BADGE_ENCLAVE_URL; `tdx` (default otherwise)
   * requires a genuine Intel TDX quote matching the pins (BADGE_ENCLAVE_COMPOSE_HASH,
   * BADGE_ENCLAVE_APP_ID, BADGE_ENCLAVE_OS_MEASUREMENTS_FILE: see `enclavePinsFromEnv`).
   */
  BADGE_ATTESTATION_MODE: z.enum(["simulated", "tdx"]).optional(),
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
  /**
   * `1` enables the rehearsal helpers: the "Auto review" button and its route, which walk the review on the device
   * and hold "Hold to sign" without a human reading it. Off unless set (never in a real deployment).
   */
  BADGE_REHEARSAL: z.enum(["0", "1"]).default("0"),
  /** Overrides the measurement the mock enclave pins messages to (e.g. the dstack simulator's compose hash). */
  BADGE_MOCK_MEASUREMENT: z.string().regex(BYTES32_HEX).optional(),
});

export interface LiveEnclaveConfig {
  baseUrl: string;
  attestationMode: "simulated" | "tdx";
  /** What the quote must match: compose hash, app id and OS measurements (all mandatory in tdx mode). */
  pins: EnclavePins;
  /** Absolute directory of the agent runtime's persisted state. */
  dataDir: string;
}

export interface ServerConfig {
  enclaveMode: "mock" | "live";
  live: LiveEnclaveConfig;
  speculosUrls: Readonly<Record<EmployeeId, string>>;
  calTestKeyPath: string | undefined;
  mockMeasurement: `0x${string}` | undefined;
  /** Rehearsal helpers (automatic device review) enabled. */
  rehearsal: boolean;
}

let cached: ServerConfig | undefined;

/**
 * Validates a server environment (exported for tests; the app uses {@link serverConfig}).
 * @throws ConfigError when an environment variable is malformed or a tdx pin is missing.
 */
export function parseServerConfig(
  rawEnv: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string = (path) => readFileSync(resolve(path), "utf8"),
): ServerConfig {
  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) throw new ConfigError(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  const env = parsed.data;
  // Simulated attestation skips DCAP: whoever terminates TLS in front of a remote enclave could forge the quote.
  // It is therefore only the default, and only allowed, for an enclave on the loopback interface.
  const loopback = isLoopbackUrl(env.BADGE_ENCLAVE_URL);
  const attestationMode = env.BADGE_ATTESTATION_MODE ?? (loopback ? "simulated" : "tdx");
  if (attestationMode === "simulated" && !loopback) {
    throw new ConfigError(
      `Invalid environment: BADGE_ATTESTATION_MODE=simulated is only allowed for a loopback enclave, not ${env.BADGE_ENCLAVE_URL}`,
    );
  }
  // Pinning is what makes a TDX quote meaningful: without it, any genuine CVM running any code would be accepted.
  let pins: EnclavePins;
  try {
    pins = enclavePinsFromEnv(rawEnv, attestationMode, readFile);
  } catch (error) {
    if (error instanceof BadgeApiError) throw new ConfigError(`Invalid environment: ${error.message}`);
    throw error;
  }
  return {
    enclaveMode: env.BADGE_ENCLAVE_MODE,
    live: {
      baseUrl: env.BADGE_ENCLAVE_URL,
      attestationMode,
      pins,
      dataDir: resolve(env.BADGE_WEB_DATA_DIR),
    },
    speculosUrls: {
      alice: env.BADGE_SPECULOS_ALICE,
      bob: env.BADGE_SPECULOS_BOB,
      chloe: env.BADGE_SPECULOS_CHLOE,
    },
    calTestKeyPath: env.BADGE_CAL_TEST_KEY,
    mockMeasurement: env.BADGE_MOCK_MEASUREMENT as `0x${string}` | undefined,
    rehearsal: env.BADGE_REHEARSAL === "1",
  };
}

/** @throws ConfigError when an environment variable is malformed. */
export function serverConfig(): ServerConfig {
  cached ??= parseServerConfig(process.env);
  return cached;
}
