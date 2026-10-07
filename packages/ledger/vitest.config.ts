import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ledger",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Live tests drive running Speculos devices; they only run through `pnpm test:speculos`.
    exclude: ["test/live/**", "**/node_modules/**"],
  },
});
