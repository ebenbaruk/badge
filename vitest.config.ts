import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/enclave", "apps/mcp", "apps/web"],
  },
});
