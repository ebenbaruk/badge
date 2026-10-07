import { describe, expect, it } from "vitest";
import { innerRequestSchema } from "../src/channel-wire";

const inner = (path: string) => ({ method: "GET", path, headers: {}, body: null });

describe("innerRequestSchema", () => {
  it("accepts API paths with encoded ids and a query", () => {
    expect(innerRequestSchema.safeParse(inner("/v1/desks/research%2Fx?limit=5")).success).toBe(true);
    expect(innerRequestSchema.safeParse(inner("/v1/audit?afterSeq=3&limit=10")).success).toBe(true);
  });

  it.each([
    "/v1/../health",
    "/v1/%2e%2e/v1/channel/open",
    "/v1/.%2E/health",
    "/v1/%2E%2e/health",
    "/v1/desks/%2e",
    "/v1/./tasks",
    "/v1/channel/open",
  ])("refuses %s (escapes /v1 or reaches the channel once normalised)", (path) => {
    expect(innerRequestSchema.safeParse(inner(path)).success).toBe(false);
  });
});
