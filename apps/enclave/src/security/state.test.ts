import { EnclaveChannel, generateX25519KeyPair } from "@badge/attest";
import type { DstackAgent } from "@badge/attest/server";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ChannelTable } from "./channel-table";
import { InMemoryKeyVersionStore, KeyRotator } from "./keys";
import { ReplayCache } from "./replay-cache";
import { mountSecurityRoutes } from "./routes";
import type { BadgeEnv } from "./types";

function manualClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

/** getKey returns a key derived from the path, so distinct paths give distinct keys. */
function stubDstack(paths: string[] = []): DstackAgent {
  return {
    getQuote: async () => {
      throw new Error("not used");
    },
    info: async () => ({ app_id: "app", compose_hash: "cd".repeat(32), tcb_info: { app_compose: "{}" } }),
    getKey: async (path) => {
      paths.push(path);
      const key = new Uint8Array(32);
      for (let i = 0; i < path.length; i += 1) key[i % 32] = (key[i % 32] ?? 0) ^ path.charCodeAt(i);
      return { key };
    },
  };
}

function freshChannel(): EnclaveChannel {
  const client = generateX25519KeyPair();
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  return EnclaveChannel.accept(
    { nonce, clientPk: Buffer.from(client.publicKey).toString("hex") },
    generateX25519KeyPair().secretKey,
  );
}

describe("ReplayCache", () => {
  it("detects replays until expiry, then forgets", () => {
    const cache = new ReplayCache(10);
    expect(cache.checkAndRemember("a", 100, 0)).toBe("fresh");
    expect(cache.checkAndRemember("a", 100, 50)).toBe("replay");
    expect(cache.checkAndRemember("a", 300, 150)).toBe("fresh");
  });

  it("evicts expired entries when full and refuses when every entry is live", () => {
    const cache = new ReplayCache(2);
    cache.checkAndRemember("a", 200, 0);
    cache.checkAndRemember("b", 100, 0);
    expect(cache.checkAndRemember("c", 300, 50)).toBe("full");
    // "b" expired (behind a live "a"): the full sweep finds it.
    expect(cache.checkAndRemember("c", 300, 150)).toBe("fresh");
    expect(cache.size).toBe(2);
  });
});

describe("ChannelTable", () => {
  it("expires idle channels and refreshes used ones", () => {
    const clock = manualClock();
    const table = new ChannelTable(clock, 1_000, 10);
    const channel = freshChannel();
    table.add(channel);
    clock.advance(900);
    expect(table.get(channel.channelId)).toBe(channel);
    clock.advance(900);
    expect(table.has(channel.channelId)).toBe(true);
    clock.advance(1_001);
    expect(() => table.get(channel.channelId)).toThrow(expect.objectContaining({ code: "CHANNEL_UNKNOWN" }));
  });

  it("refuses a re-used handshake and new channels when full", () => {
    const table = new ChannelTable(manualClock(), 1_000, 1);
    const channel = freshChannel();
    table.add(channel);
    expect(() => table.add(channel)).toThrow(expect.objectContaining({ code: "CHANNEL_EXISTS" }));
    expect(() => table.add(freshChannel())).toThrow(expect.objectContaining({ code: "CHANNEL_CAPACITY" }));
  });
});

describe("KeyRotator", () => {
  it("derives versioned keys from fixed paths and rotates", async () => {
    const paths: string[] = [];
    const store = new InMemoryKeyVersionStore();
    const keys = new KeyRotator(stubDstack(paths), store);
    const v1 = await keys.currentDek("alice");
    expect(v1.version).toBe(1);
    expect(paths).toEqual(["badge/dek/alice:1"]);

    await expect(Promise.all([keys.rotate("alice"), keys.rotate("alice")])).resolves.toEqual([2, 3]);
    expect(store.getVersion("alice")).toBe(3);
    const v3 = await keys.currentDek("alice");
    expect(v3.version).toBe(3);
    expect(v3.key).not.toEqual(v1.key);
    // Old versions stay derivable (data written before the rotation), and derivations are cached.
    expect(await keys.dekFor("alice", 1)).toEqual(v1.key);
    expect(paths.filter((path) => path === "badge/dek/alice:1")).toHaveLength(1);
  });

  it("rejects ids and versions that could collide in a key path", async () => {
    const keys = new KeyRotator(stubDstack(), new InMemoryKeyVersionStore());
    expect(() => keys.dekFor("alice:2", 1)).toThrow(RangeError);
    expect(() => keys.dekFor("Alice", 1)).toThrow(RangeError);
    expect(() => keys.dekFor("alice", 0)).toThrow(RangeError);
  });

  it("does not cache a KMS failure", async () => {
    let fail = true;
    const dstack: DstackAgent = {
      ...stubDstack(),
      getKey: async () => {
        if (fail) throw new Error("socket closed");
        return { key: new Uint8Array(32).fill(1) };
      },
    };
    const keys = new KeyRotator(dstack, new InMemoryKeyVersionStore());
    await expect(keys.dekFor("bob", 1)).rejects.toMatchObject({ code: "DSTACK_FAILED" });
    fail = false;
    await expect(keys.dekFor("bob", 1)).resolves.toHaveLength(32);
  });
});

describe("mountSecurityRoutes", () => {
  function app(requireChannel: boolean) {
    const hono = new Hono<BadgeEnv>();
    mountSecurityRoutes(hono, {
      dstack: stubDstack(),
      sessions: { resolve: async () => null },
      clock: manualClock(),
      requireChannel,
    });
    hono.get("/v1/consents", (c) => c.json({ ok: true }));
    hono.get("/health", (c) => c.json({ ok: true }));
    return hono;
  }

  it("serves the measurement as bytes32 of the compose hash", async () => {
    const response = await app(false).request("/v1/attestation/measurement");
    expect(await response.json()).toEqual({
      measurement: `0x${"cd".repeat(32)}`,
      composeHash: "cd".repeat(32),
      appId: "app",
    });
  });

  it("requires the channel in production mode, but not for health and measurement", async () => {
    const strict = app(true);
    const plain = await strict.request("/v1/consents");
    expect(plain.status).toBe(403);
    expect(await plain.json()).toMatchObject({ error: { code: "CHANNEL_REQUIRED" } });
    expect((await strict.request("/health")).status).toBe(200);
    expect((await strict.request("/v1/attestation/measurement")).status).toBe(200);
    // Without the guard the same call reaches authentication instead.
    expect((await app(false).request("/v1/consents")).status).toBe(401);
  });

  it("answers channel errors in the API error format", async () => {
    const hono = app(false);
    const unknown = await hono.request(`/v1/channel/${"ab".repeat(32)}`, {
      method: "POST",
      body: JSON.stringify({ sealed: { channelId: "ab".repeat(32), seq: 0, ciphertext: "00" } }),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "CHANNEL_UNKNOWN" } });
    const malformed = await hono.request("/v1/channel/open", { method: "POST", body: "{" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_BODY" } });
  });
});
