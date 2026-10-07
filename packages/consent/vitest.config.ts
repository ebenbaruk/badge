import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "consent",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
