import { defineConfig } from "vitest/config";

/** Integration tests that need the dstack simulator (infra/dstack-sim.sh start): `pnpm test:sim`. */
export default defineConfig({
  test: {
    name: "enclave-sim",
    include: ["test/sim/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
