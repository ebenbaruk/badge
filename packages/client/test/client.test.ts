import { encodeBadgeMessage, type SignedMessage } from "@badge/consent";
import { recoverMessageAddress, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  BADGE_AUTH_HEADERS,
  BadgeApiError,
  BadgeClient,
  canonicalRequest,
  createAgentSession,
  ENCLAVE_MAX_SESSION_TTL_SECONDS,
  type FetchLike,
} from "../src";

const BASE_URL = "http://enclave.test";
const NOW = 1_790_000_000_000;
const MEASUREMENT: Hex = `0x${"ab".repeat(32)}`;
const ALICE = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const sessionKey = privateKeyToAccount(`0x${"11".repeat(32)}`);

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A fetch that records requests and answers with the queued responses in order. */
function mockFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: Recorded[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : null,
    });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(text, {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchFn };
}

function client(fetchFn: FetchLike, withKey = true) {
  return new BadgeClient({
    baseUrl: `${BASE_URL}/`,
    transport: "plain",
    attestationMode: "simulated",
    fetch: fetchFn,
    now: () => NOW,
    ...(withKey ? { sessionKey } : {}),
  });
}

const task = {
  id: `0x${"01".repeat(32)}`,
  taskLabel: "Brief client Durand",
  status: "waiting_consent",
  allowed: [{ ownerId: "company", ownerName: "Acme", excerptLabel: "Catalogue 2026", via: "company" }],
  pending: [
    {
      consentId: "c1",
      ownerId: "bob",
      ownerName: "Bob Durand",
      excerptLabel: "Notes client",
      excerptLength: 120,
      risk: { level: "ok", flags: [] },
    },
  ],
  blocked: [],
  brief: null,
  tokenStats: null,
  createdAt: 1_790_000_000,
};

describe("request signing", () => {
  it("builds the canonical string", () => {
    const signed = canonicalRequest({
      method: "post",
      pathWithQuery: "/v1/tasks?x=1",
      timestamp: 42,
      body: stringToBytes(""),
    });
    expect(signed).toBe(
      "BADGE-REQ-V1\nPOST\n/v1/tasks?x=1\n42\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("signs authenticated calls with the session key over method, path, ts and body", async () => {
    const { calls, fetchFn } = mockFetch({ body: task });
    const result = await client(fetchFn).createTask({
      task: "Prepare the Durand meeting",
      taskLabel: "Brief",
    });
    expect(result.status).toBe("waiting_consent");

    const [call] = calls;
    expect(call?.url).toBe(`${BASE_URL}/v1/tasks`);
    expect(call?.headers[BADGE_AUTH_HEADERS.session]).toBe(sessionKey.address);
    expect(call?.headers[BADGE_AUTH_HEADERS.timestamp]).toBe(String(NOW));
    const message = canonicalRequest({
      method: "POST",
      pathWithQuery: "/v1/tasks",
      timestamp: NOW,
      body: stringToBytes(call?.body ?? ""),
    });
    const signer = await recoverMessageAddress({
      message,
      signature: call?.headers[BADGE_AUTH_HEADERS.signature] as Hex,
    });
    expect(signer).toBe(sessionKey.address);
  });

  it("uses strictly increasing timestamps so identical calls are not replays", async () => {
    const { calls, fetchFn } = mockFetch({ body: task }, { body: task });
    const badge = client(fetchFn);
    await badge.getTask(task.id);
    await badge.getTask(task.id);
    expect(calls.map((call) => call.headers[BADGE_AUTH_HEADERS.timestamp])).toEqual([
      String(NOW),
      String(NOW + 1),
    ]);
  });

  it("sends onboarding calls unsigned, as encoded signed messages", async () => {
    const created = createAgentSession(ALICE, { agentName: "Claude Code", enclaveMeasurement: MEASUREMENT });
    const signed: SignedMessage<"AgentSession"> = {
      kind: "AgentSession",
      message: created.message,
      signature: `0x${"22".repeat(65)}`,
    };
    const { calls, fetchFn } = mockFetch({
      body: {
        sessionKey: created.sessionKey.address,
        employeeId: "alice",
        agentName: "Claude Code",
        expiresAt: 1,
      },
    });
    await client(fetchFn, false).openSession(signed);
    expect(calls[0]?.headers[BADGE_AUTH_HEADERS.signature]).toBeUndefined();
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      kind: "AgentSession",
      message: encodeBadgeMessage("AgentSession", created.message),
      signature: signed.signature,
    });
  });

  it("refuses an authenticated call without a session key", async () => {
    const { calls, fetchFn } = mockFetch();
    await expect(client(fetchFn, false).listConsents()).rejects.toMatchObject({ code: "no_session_key" });
    expect(calls).toHaveLength(0);
  });
});

describe("responses", () => {
  it("decodes signed messages inside consent requests (bigints restored)", async () => {
    const share = {
      recipientName: "Alice Martin (Ventes)",
      excerptLabel: "Notes client Durand",
      excerptLength: 120,
      taskLabel: "Brief",
      expiresAt: "1790086400",
      excerptHash: `0x${"03".repeat(32)}`,
      enclaveMeasurement: MEASUREMENT,
      recipient: ALICE,
      owner: "0x58A57ed9d8d624cBD12e2C467D34787555bB1b25",
      taskId: task.id,
      nonce: "7",
    };
    const { fetchFn } = mockFetch({
      body: {
        consents: [
          {
            kind: "ContextShare",
            id: "c1",
            status: "pending",
            taskId: task.id,
            requester: { id: "alice", name: "Alice Martin", team: "Ventes" },
            message: share,
            risk: { level: "warn", flags: ["owner_share_high"] },
            createdAt: 1,
          },
        ],
      },
    });
    const [consent] = await client(fetchFn).listConsents();
    expect(consent?.kind).toBe("ContextShare");
    if (consent?.kind !== "ContextShare") throw new Error("unreachable");
    expect(consent.message.expiresAt).toBe(1_790_086_400n);
    expect(consent.message.nonce).toBe(7n);
  });

  it("maps enclave errors to BadgeApiError with the enclave's code", async () => {
    const { fetchFn } = mockFetch({
      status: 401,
      body: { error: { code: "session_unknown", message: "session is unknown, expired or revoked" } },
    });
    const error = await client(fetchFn)
      .listPolicies()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadgeApiError);
    expect(error).toMatchObject({ status: 401, code: "session_unknown", isRefusal: true });
  });

  it("rejects malformed bodies and unexpected shapes", async () => {
    const { fetchFn } = mockFetch(
      { status: 500, body: "<html>oops</html>" },
      { body: { ...task, status: "done" } },
      { body: "not json" },
    );
    const badge = client(fetchFn);
    await expect(badge.getTask(task.id)).rejects.toMatchObject({ status: 500, code: "bad_response" });
    await expect(badge.getTask(task.id)).rejects.toMatchObject({ code: "bad_response" });
    await expect(badge.getTask(task.id)).rejects.toMatchObject({ code: "bad_response" });
  });

  it("encodes path segments and reports network failures", async () => {
    const { calls, fetchFn } = mockFetch({
      body: { desk: "research", members: 3, commitments: ["1", "2", "3"], root: "42" },
    });
    await client(fetchFn).getDesk("research/../x");
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/desks/research%2F..%2Fx`);

    const failing: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(client(failing).measurement()).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("validates desk proofs before sending them", async () => {
    const { calls, fetchFn } = mockFetch();
    const bad = { merkleTreeDepth: 16, merkleTreeRoot: "x" } as never;
    await expect(
      client(fetchFn).approveDeskRequest(task.id, { signature: `0x${"22".repeat(65)}`, proof: bad }),
    ).rejects.toMatchObject({ code: "invalid_argument" });
    expect(calls).toHaveLength(0);
  });
});

describe("channel transport", () => {
  it("refuses to talk to an enclave whose attestation fails, and exposes the result", async () => {
    const { fetchFn } = mockFetch({
      body: {
        channelId: "aa".repeat(32),
        enclavePk: "bb".repeat(32),
        bundle: { quote: "00".repeat(64), eventLog: "[]", appCompose: "{}", enclavePk: "bb".repeat(32) },
      },
    });
    const badge = new BadgeClient({
      baseUrl: BASE_URL,
      transport: "channel",
      attestationMode: "simulated",
      fetch: fetchFn,
      sessionKey,
    });
    await expect(badge.measurement()).rejects.toMatchObject({ code: "attestation_failed" });
    expect(badge.attestation?.ok).toBe(false);
  });

  it("connect() is only for the channel transport", async () => {
    await expect(client(mockFetch().fetchFn).connect()).rejects.toMatchObject({ code: "invalid_argument" });
  });
});

describe("createAgentSession", () => {
  it("creates a fresh key and an ASCII AgentSession bound to the enclave", () => {
    const now = new Date(NOW);
    const a = createAgentSession(ALICE, {
      agentName: "Agent d'Élodie",
      enclaveMeasurement: MEASUREMENT,
      now,
    });
    const b = createAgentSession(ALICE, { agentName: "Agent", enclaveMeasurement: MEASUREMENT, now });
    expect(a.sessionKey.address).not.toBe(b.sessionKey.address);
    expect(a.message.nonce).not.toBe(b.message.nonce);
    expect(a.message.agentName).toBe("Agent d'Elodie");
    expect(a.message.sessionKey).toBe(a.sessionKey.address);
    expect(a.message.employee).toBe(ALICE);
    expect(a.message.expiresAt).toBe(BigInt(NOW / 1000) + 8n * 3600n);
    expect(privateKeyToAccount(a.privateKey).address).toBe(a.sessionKey.address);
  });

  it("caps the delegation", () => {
    const options = { agentName: "Agent", enclaveMeasurement: MEASUREMENT };
    expect(() =>
      createAgentSession(ALICE, { ...options, ttlSeconds: ENCLAVE_MAX_SESSION_TTL_SECONDS + 1n }),
    ).toThrow(BadgeApiError);
    expect(() => createAgentSession(ALICE, { ...options, ttlSeconds: 0n })).toThrow(/TTL/);
  });
});
