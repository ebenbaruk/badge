/**
 * End to end through the security layer: the SDK opens the attested channel against the dstack simulator, signs
 * requests with a session key, and a minimal Hono app (security routes + one stub domain route) answers sealed.
 * Needs `infra/dstack-sim.sh start`; run with `pnpm --filter @badge/enclave test:sim`.
 */
import { ClientChannel, verifyAttestation } from "@badge/attest";
import { createDstackClient, DSTACK_SIMULATOR_ENDPOINT_ENV } from "@badge/attest/server";
import {
  BadgeApiError,
  BadgeClient,
  CHANNEL_PATHS,
  type ChannelOpenResponse,
  type FetchLike,
  type Task,
} from "@badge/client";
import { Hono } from "hono";
import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import { mountSecurityRoutes, type BadgeEnv, type Caller } from "../../src/security";

const DEFAULT_SIMULATOR_ENDPOINT = "http://127.0.0.1:8090";
const BASE_URL = "http://enclave.test";
const CHANNEL_IDLE_TTL_MS = 60_000;

const endpoint = process.env[DSTACK_SIMULATOR_ENDPOINT_ENV] ?? DEFAULT_SIMULATOR_ENDPOINT;
const dstack = createDstackClient(endpoint);
const agent = privateKeyToAccount(`0x${"21".repeat(32)}`);
const intruder = privateKeyToAccount(`0x${"22".repeat(32)}`);
const alice: Caller = {
  employeeId: "alice",
  address: getAddress("0x9858EfFD232B4033E47d90003D41EC34EcaEda94"),
  sessionKey: agent.address,
};

beforeAll(async () => {
  if (!(await dstack.isReachable())) {
    throw new Error(`dstack simulator not reachable at ${endpoint}: run infra/dstack-sim.sh start`);
  }
});

function enclaveApp() {
  let offset = 0;
  const clock = { now: () => Date.now() + offset, advance: (ms: number) => (offset += ms) };
  const app = new Hono<BadgeEnv>();
  mountSecurityRoutes(app, {
    dstack,
    clock,
    sessions: { resolve: async (key: Address) => (key === agent.address ? alice : null) },
    requireChannel: true,
    channelIdleTtlMs: CHANNEL_IDLE_TTL_MS,
  });
  app.post("/v1/tasks", async (c) => {
    const input = (await c.req.json()) as { taskLabel: string };
    const task: Task = {
      id: `0x${"01".repeat(32)}`,
      taskLabel: `${input.taskLabel} for ${c.var.caller.employeeId}`,
      status: "ready",
      allowed: [],
      pending: [],
      blocked: [],
      refused: [],
      brief: "brief",
      tokenStats: { selectedTokens: 10, allContextTokens: 100 },
      createdAt: 1,
    };
    return c.json(task);
  });
  // In-process HTTP: the SDK's fetch goes straight to the Hono app.
  const fetchFn: FetchLike = async (url, init) => app.request(url, init);
  return { app, clock, fetchFn };
}

function sdk(fetchFn: FetchLike, sessionKey = agent, now: () => number = Date.now) {
  return new BadgeClient({
    baseUrl: BASE_URL,
    transport: "channel",
    attestationMode: "simulated",
    fetch: fetchFn,
    sessionKey,
    now,
  });
}

describe("attested channel + request auth (dstack simulator)", () => {
  it("attests the enclave, then carries signed requests sealed both ways", async () => {
    const { fetchFn } = enclaveApp();
    const seen: string[] = [];
    const badge = sdk(async (url, init) => {
      seen.push(url);
      return fetchFn(url, init);
    });

    const attestation = await badge.connect();
    expect(attestation.simulated).toBe(true);
    expect(badge.attestation?.ok).toBe(true);

    const task = await badge.createTask({ task: "Prepare the Durand meeting", taskLabel: "Brief" });
    expect(task.taskLabel).toBe("Brief for alice");
    // The measurement served through the channel is the one the quote attests.
    const { measurement } = await badge.measurement();
    expect(measurement).toBe(attestation.enclaveMeasurement);
    // Nothing but the channel routes went over "the network".
    expect(seen.every((url) => url.startsWith(`${BASE_URL}${CHANNEL_PATHS.prefix}`))).toBe(true);
  });

  it("refuses plain API calls and unknown sessions", async () => {
    const { fetchFn } = enclaveApp();
    const plain = new BadgeClient({
      baseUrl: BASE_URL,
      transport: "plain",
      attestationMode: "simulated",
      fetch: fetchFn,
      sessionKey: agent,
    });
    await expect(plain.createTask({ task: "x", taskLabel: "x" })).rejects.toMatchObject({
      status: 403,
      code: "channel_required",
    });
    await expect(sdk(fetchFn, intruder).createTask({ task: "x", taskLabel: "x" })).rejects.toMatchObject({
      status: 401,
      code: "session_unknown",
    });
  });

  it("reopens an expired channel transparently", async () => {
    const { fetchFn, clock } = enclaveApp();
    const opens: string[] = [];
    const counting: FetchLike = async (url, init) => {
      if (url.endsWith(CHANNEL_PATHS.open)) opens.push(url);
      return fetchFn(url, init);
    };
    // The client follows the enclave clock so request timestamps stay within the skew window.
    const badge = sdk(counting, agent, clock.now);
    await badge.createTask({ task: "x", taskLabel: "one" });
    await badge.createTask({ task: "x", taskLabel: "two" });
    expect(opens).toHaveLength(1);
    clock.advance(CHANNEL_IDLE_TTL_MS + 1);
    await expect(badge.createTask({ task: "x", taskLabel: "three" })).resolves.toMatchObject({
      taskLabel: "three for alice",
    });
    expect(opens).toHaveLength(2);
  });

  it("rejects replayed, tampered and re-opened channel traffic", async () => {
    const { app } = enclaveApp();
    const client = ClientChannel.create();
    const open = (body: unknown) =>
      app.request(CHANNEL_PATHS.open, { method: "POST", body: JSON.stringify(body) });
    const opened = (await (await open(client.hello)).json()) as ChannelOpenResponse;
    const result = await verifyAttestation({ ...opened.bundle, ...client.hello, mode: "simulated" });
    if (!result.ok) throw new Error(result.reason);
    client.establish(result);

    // Same hello again: would reset the enclave's sequence numbers, so it is refused.
    expect((await open(client.hello)).status).toBe(409);

    const post = (sealed: unknown) =>
      app.request(CHANNEL_PATHS.message(opened.channelId), {
        method: "POST",
        body: JSON.stringify({ sealed }),
      });
    const sealed = client.seal({
      method: "GET",
      path: "/v1/attestation/measurement",
      headers: {},
      body: null,
    });
    expect((await post(sealed)).status).toBe(200);
    const replayed = await post(sealed);
    expect(replayed.status).toBe(400);
    expect(await replayed.json()).toMatchObject({ error: { code: "channel_rejected" } });

    const next = client.seal({ method: "GET", path: "/v1/attestation/measurement", headers: {}, body: null });
    const flipped = (next.ciphertext[0] === "0" ? "1" : "0") + next.ciphertext.slice(1);
    expect((await post({ ...next, ciphertext: flipped })).status).toBe(400);
    // The forged message did not desynchronise the channel: the genuine one still goes through.
    expect((await post(next)).status).toBe(200);

    const nested = client.seal({ method: "POST", path: CHANNEL_PATHS.open, headers: {}, body: "{}" });
    expect((await post(nested)).status).toBe(400);
  });

  it("surfaces enclave refusals as BadgeApiError", async () => {
    const { fetchFn } = enclaveApp();
    const error = await sdk(fetchFn)
      .getTask("missing")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadgeApiError);
    expect(error).toMatchObject({ status: 404 });
  });
});
