import { defineConfig } from "vitest/config";

/** Groth16 proving takes about 1 s per proof and the proof suite generates several in a single hook or test. */
const PROOF_TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    name: "zk",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: PROOF_TEST_TIMEOUT_MS,
    hookTimeout: PROOF_TEST_TIMEOUT_MS,
  },
});
