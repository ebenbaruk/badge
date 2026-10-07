import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "attest",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
