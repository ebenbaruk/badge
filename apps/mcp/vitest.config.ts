import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "mcp",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Needs the dstack simulator: only through `pnpm test:sim`.
    exclude: ["test/sim/**", "**/node_modules/**"],
  },
});
