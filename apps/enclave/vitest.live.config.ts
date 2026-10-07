import { defineConfig } from "vitest/config";

/** Live tests: need `infra/stack.sh up` + `seed`, and the LLM profile secrets (BADGE_ENV_FILE). */
export default defineConfig({
  test: {
    name: "enclave-live",
    include: ["test/live/**/*.test.ts"],
    testTimeout: 120_000,
    // One LLM call at a time: keeps cost and rate limits predictable.
    fileParallelism: false,
  },
});
