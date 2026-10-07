import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "zk",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
