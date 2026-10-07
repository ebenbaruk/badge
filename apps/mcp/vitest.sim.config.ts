import { defineConfig } from "vitest/config";

/** End-to-end tests over the attested channel; need the dstack simulator (infra/dstack-sim.sh start). */
export default defineConfig({
  test: {
    name: "mcp-sim",
    include: ["test/sim/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
