import { defineConfig } from "vitest/config";

/** Integration tests that need the dstack simulator (infra/dstack-sim.sh start): `pnpm test:sim`. */
export default defineConfig({
  test: {
    name: "attest-sim",
    include: ["test/live/**/*.test.ts"],
  },
});
