import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "attest",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // test/live needs the dstack simulator and the network: run it with `pnpm test:sim`.
    exclude: ["test/live/**", "**/node_modules/**"],
  },
});
