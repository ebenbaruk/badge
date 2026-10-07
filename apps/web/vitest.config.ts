import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The desk test generates a real Groth16 proof (~1-2 s cold).
    testTimeout: 30_000,
  },
});
