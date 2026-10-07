import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ledger-speculos",
    include: ["test/live/**/*.test.ts"],
    // A device shows one review at a time: never interleave signatures on the same emulator.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
    // Keep the device addresses printed by devices.test.ts.
    silent: false,
  },
});
