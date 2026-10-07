import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "enclave",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Live tests hit the local stack and paid LLM endpoints: only through `pnpm test:live`.
    exclude: ["test/live/**", "test/sim/**", "**/node_modules/**"],
  },
});
