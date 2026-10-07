import { BADGE_AUTH_HEADERS, canonicalRequest } from "@badge/client";
import { Hono } from "hono";
import { getAddress, stringToBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { createAuthMiddleware, isPublicRoute, type SessionResolver } from "./auth";
import type { BadgeEnv, Caller } from "./types";

const NOW = 1_790_000_000_000;
const agent = privateKeyToAccount(`0x${"11".repeat(32)}`);
const stranger = privateKeyToAccount(`0x${"12".repeat(32)}`);
const alice: Caller = {
  employeeId: "alice",
  address: getAddress("0x9858EfFD232B4033E47d90003D41EC34EcaEda94"),
  sessionKey: agent.address,
};

function setup(options: { now?: number; resolver?: SessionResolver; capacity?: number } = {}) {
  const clock = { now: () => options.now ?? NOW };
  const resolver: SessionResolver = options.resolver ?? {
    resolve: async (key: Address) => (key === agent.address ? alice : null),
  };
  const app = new Hono<BadgeEnv>();
  app.use(
    "/v1/*",
    createAuthMiddleware(resolver, clock, {
      ...(options.capacity === undefined ? {} : { replayCacheCapacity: options.capacity }),
    }),
  );
  app.post("/v1/tasks", async (c) => c.json({ caller: c.var.caller.employeeId, body: await c.req.json() }));
  app.get("/v1/consents", (c) => c.json({ caller: c.var.caller.employeeId }));
  app.post("/v1/enroll", (c) => c.json({ public: true }));
  return app;
}

async function signedInit(
  method: string,
  pathWithQuery: string,
  body: string | null,
  options: { ts?: number; signer?: typeof agent; session?: Address } = {},
): Promise<RequestInit> {
  const timestamp = options.ts ?? NOW;
  const signer = options.signer ?? agent;
  const message = canonicalRequest({
    method,
    pathWithQuery,
    timestamp,
    body: stringToBytes(body ?? ""),
  });
  return {
    method,
    headers: {
      "content-type": "application/json",
      [BADGE_AUTH_HEADERS.session]: options.session ?? signer.address,
      [BADGE_AUTH_HEADERS.timestamp]: String(timestamp),
      [BADGE_AUTH_HEADERS.signature]: await signer.signMessage({ message }),
    },
    ...(body === null ? {} : { body }),
  };
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return body.error.code;
}

describe("auth middleware", () => {
  it("authenticates a signed request, exposes the caller and keeps the body readable", async () => {
    const app = setup();
    const body = JSON.stringify({ task: "brief", taskLabel: "Brief" });
    const response = await app.request("/v1/tasks", await signedInit("POST", "/v1/tasks", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ caller: "alice", body: { task: "brief", taskLabel: "Brief" } });
  });

  it("signs the query string too", async () => {
    const app = setup();
    const init = await signedInit("GET", "/v1/consents?status=pending", null);
    expect((await app.request("/v1/consents?status=pending", init)).status).toBe(200);
    const swapped = await app.request("/v1/consents?status=all", init);
    expect(await errorCode(swapped)).toBe("BAD_SIGNATURE");
  });

  it("lets public routes through without headers", async () => {
    const response = await setup().request("/v1/enroll", { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(isPublicRoute("GET", "/v1/enroll")).toBe(false);
    expect(isPublicRoute("POST", "/v1/channel/abc")).toBe(true);
    expect(isPublicRoute("GET", "/health")).toBe(true);
  });

  it.each([
    ["missing headers", async () => ({ method: "GET" }), "AUTH_MISSING"],
    [
      "a malformed session",
      async () => {
        const init = await signedInit("GET", "/v1/consents", null);
        return { ...init, headers: { ...init.headers, [BADGE_AUTH_HEADERS.session]: "alice" } };
      },
      "AUTH_MALFORMED",
    ],
    ["a stale timestamp", () => signedInit("GET", "/v1/consents", null, { ts: NOW - 61_000 }), "CLOCK_SKEW"],
    ["a future timestamp", () => signedInit("GET", "/v1/consents", null, { ts: NOW + 61_000 }), "CLOCK_SKEW"],
    [
      "a signature by another key",
      () => signedInit("GET", "/v1/consents", null, { signer: stranger, session: agent.address }),
      "BAD_SIGNATURE",
    ],
    [
      "an unknown session",
      () => signedInit("GET", "/v1/consents", null, { signer: stranger }),
      "SESSION_UNKNOWN",
    ],
    ["a signature for another method", () => signedInit("POST", "/v1/consents", null), "BAD_SIGNATURE"],
  ])("refuses %s", async (_label, makeInit, code) => {
    const init = (await makeInit()) as RequestInit;
    const response = await setup().request("/v1/consents", { ...init, method: "GET" });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe(code);
  });

  it("refuses a tampered body", async () => {
    const init = await signedInit("POST", "/v1/tasks", JSON.stringify({ task: "a" }));
    const response = await setup().request("/v1/tasks", { ...init, body: JSON.stringify({ task: "b" }) });
    expect(await errorCode(response)).toBe("BAD_SIGNATURE");
  });

  it("refuses replays, including under a malleated twin signature", async () => {
    const app = setup();
    const init = await signedInit("GET", "/v1/consents", null);
    expect((await app.request("/v1/consents", init)).status).toBe(200);
    const replay = await app.request("/v1/consents", init);
    expect(await errorCode(replay)).toBe("REPLAY");

    // s -> n - s (and v flipped) is another valid signature of the same message.
    const headers = init.headers as Record<string, string>;
    const sig = headers[BADGE_AUTH_HEADERS.signature] ?? "";
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const v = Number.parseInt(sig.slice(130), 16);
    const twin = `${sig.slice(0, 66)}${(n - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}`;
    const malleated = await app.request("/v1/consents", {
      ...init,
      headers: { ...headers, [BADGE_AUTH_HEADERS.signature]: twin },
    });
    expect(await errorCode(malleated)).toBe("REPLAY");
  });

  it("fails closed when the replay cache is full", async () => {
    const app = setup({ capacity: 1 });
    expect((await app.request("/v1/consents", await signedInit("GET", "/v1/consents", null))).status).toBe(
      200,
    );
    const second = await app.request(
      "/v1/consents",
      await signedInit("GET", "/v1/consents", null, { ts: NOW + 1 }),
    );
    expect(second.status).toBe(503);
    expect(await errorCode(second)).toBe("REPLAY_CACHE_FULL");
  });

  it("refuses a resolver answer for another session", async () => {
    const app = setup({ resolver: { resolve: async () => ({ ...alice, sessionKey: stranger.address }) } });
    const response = await app.request("/v1/consents", await signedInit("GET", "/v1/consents", null));
    expect(await errorCode(response)).toBe("SESSION_UNKNOWN");
  });

  it("refuses oversized bodies before verifying anything", async () => {
    const big = JSON.stringify({ task: "x".repeat(300 * 1024) });
    const response = await setup().request("/v1/tasks", await signedInit("POST", "/v1/tasks", big));
    expect(response.status).toBe(413);
  });
});
