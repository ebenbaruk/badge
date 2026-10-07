/**
 * Server configuration, read once from the environment and validated (fail fast on a typo, not mid-demo).
 */
import { z } from "zod";
import type { EmployeeId } from "@/lib/directory";
import { ConfigError } from "./errors";

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;

const envSchema = z.object({
  BADGE_ENCLAVE_MODE: z.enum(["mock", "live"]).default("mock"),
  BADGE_SPECULOS_ALICE: z.url().default("http://localhost:5001"),
  BADGE_SPECULOS_BOB: z.url().default("http://localhost:5002"),
  BADGE_SPECULOS_CHLOE: z.url().default("http://localhost:5003"),
  /** Test CAL key (PEM) used to sign the clear-signing filters; bundled code cannot rely on the package default. */
  BADGE_CAL_TEST_KEY: z.string().min(1).optional(),
  /** Overrides the measurement the mock enclave pins messages to (e.g. the dstack simulator's compose hash). */
  BADGE_MOCK_MEASUREMENT: z.string().regex(BYTES32_HEX).optional(),
});

export interface ServerConfig {
  enclaveMode: "mock" | "live";
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
