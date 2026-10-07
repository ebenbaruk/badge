/**
 * End to end over the attested channel: the MCP server loads a session file, attests the enclave's security layer
 * running on the dstack simulator, and the harness calls the tools; every enclave call is sealed and signed with the
 * session key. The domain routes are stubs (the security layer is the real one).
 * Needs `infra/dstack-sim.sh start`; run with `pnpm --filter @badge/mcp test:sim`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDstackClient, DSTACK_SIMULATOR_ENDPOINT_ENV } from "@badge/attest/server";
import { CHANNEL_PATHS, createAgentSession, type FetchLike, type Task } from "@badge/client";
import { mountSecurityRoutes, type BadgeEnv } from "@badge/enclave";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { getAddress, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EnclaveConfig } from "../../src/config";
import { connectEnclave, createEnclaveClient } from "../../src/enclave";
import { createBadgeMcpServer } from "../../src/server";
import { readSessionFile, requireUsableSession, writeSessionFile } from "../../src/session-file";

const DEFAULT_SIMULATOR_ENDPOINT = "http://127.0.0.1:8090";
const BASE_URL = "http://enclave.test";
const ALICE = getAddress("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
const TASK_ID: Hex = `0x${"01".repeat(32)}`;
// Never checked by the stub: opening the session is the enclave domain's job, not this test's.
const SIGNATURE: Hex = `0x${"12".repeat(65)}`;

const endpoint = process.env[DSTACK_SIMULATOR_ENDPOINT_ENV] ?? DEFAULT_SIMULATOR_ENDPOINT;
const dstack = createDstackClient(endpoint);
const config: EnclaveConfig = {
  enclaveUrl: BASE_URL,
  enclaveTransport: "channel",
  attestationMode: "simulated",
  pins: {},
};

function task(status: Task["status"]): Task {
  return {
    id: TASK_ID,
    taskLabel: "Brief Durand",
    status,
    allowed: [],
    pending:
      status === "ready"
        ? []
        : [
            {
              consentId: "c1",
              ownerId: "bob",
              ownerName: "Bob Durand",
              excerptLabel: "Contexte personnel de Bob Durand",
              excerptLength: 420,
              risk: { level: "ok", reasons: [] },
            },
          ],
    blocked: [],
    refused: [],
    brief: status === "ready" ? "Brief redige dans l'enclave" : null,
    tokenStats: status === "ready" ? { selectedTokens: 1, allContextTokens: 2 } : null,
    createdAt: 1,
  };
}

/** The real security layer (channel, request signatures, sessions) in front of stub domain routes. */
function enclave(agentKey: () => Address | undefined) {
  const app = new Hono<BadgeEnv>();
  const seenPaths: string[] = [];
  mountSecurityRoutes(app, {
    dstack,
    clock: { now: () => Date.now() },
    sessions: {
      resolve: async (key: Address) =>
        key === agentKey() ? { employeeId: "alice", address: ALICE, sessionKey: key } : null,
    },
    requireChannel: true,
  });
  app.post("/v1/tasks", (c) => c.json(task("waiting_consent"), 201));
  app.get("/v1/tasks/:id", (c) => c.json(task("ready")));
  app.get("/v1/consents", (c) => c.json({ consents: [] }));
  const fetchFn: FetchLike = async (url, init) => {
    seenPaths.push(new URL(url).pathname);
    return app.request(url, init);
  };
  return { fetchFn, seenPaths };
}

function textOf(result: unknown): string {
  return (result as CallToolResult).content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

describe("MCP server through the attested channel (dstack simulator)", () => {
  let dir: string;
  let sessionKey: Address | undefined;
  const { fetchFn, seenPaths } = enclave(() => sessionKey);

  beforeAll(async () => {
    if (!(await dstack.isReachable())) {
      throw new Error(`dstack simulator not reachable at ${endpoint}: run infra/dstack-sim.sh start`);
    }
    dir = await mkdtemp(join(tmpdir(), "badge-mcp-sim-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function sessionFile(measurement: Hex): Promise<string> {
    const created = createAgentSession(ALICE, { agentName: "Claude Code", enclaveMeasurement: measurement });
    const file = join(dir, `${created.sessionKey.address}.json`);
    await writeSessionFile(
      file,
      { privateKey: created.privateKey, message: created.message, signature: SIGNATURE },
      { overwrite: false },
    );
    return file;
  }

  it("attests, then serves the tools with signed, sealed enclave calls", async () => {
    const { enclaveMeasurement } = await createEnclaveClient(config, undefined, fetchFn).connect();
    const session = requireUsableSession(
      await readSessionFile(await sessionFile(enclaveMeasurement)),
      new Date(),
    );
    sessionKey = session.account.address;
    const warnings: string[] = [];
    const api = await connectEnclave(config, session, { fetch: fetchFn, warn: (w) => warnings.push(w) });
    expect(warnings).toEqual([]);

    const server = createBadgeMcpServer({
      api,
      enclaveTransport: "channel",
      session: { ...session.message },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "sim-harness", version: "1.0.0" });
    await client.connect(clientTransport);

    const pending = await client.callTool({
      name: "badge_get_context",
      arguments: { task: "Preparer le rendez-vous Durand", taskLabel: "Brief Durand" },
    });
    expect(textOf(pending)).toContain("En attente de l'accord de Bob Durand sur son Ledger");
    const ready = await client.callTool({ name: "badge_task_status", arguments: { taskId: TASK_ID } });
    expect(textOf(ready)).toContain("Brief redige dans l'enclave");
    const attestation = await client.callTool({ name: "badge_attestation", arguments: {} });
    expect(textOf(attestation)).toContain("Enclave SIMULÉE");
    expect(textOf(attestation)).toContain("identique à l'enclave attestée");

    // Only the channel routes ever crossed "the network": every API call was sealed.
    expect(seenPaths.every((path) => path.startsWith(CHANNEL_PATHS.prefix))).toBe(true);
    await client.close();
  });

  it("refuses to start with a session signed for another enclave", async () => {
    const stale = requireUsableSession(
      await readSessionFile(await sessionFile(`0x${"66".repeat(32)}`)),
      new Date(),
    );
    await expect(connectEnclave(config, stale, { fetch: fetchFn, warn: () => {} })).rejects.toMatchObject({
      code: "MEASUREMENT_MISMATCH",
    });
  });

  it("refuses to start in tdx mode: the simulator's quote is not genuine TDX evidence", async () => {
    const session = requireUsableSession(
      await readSessionFile(await sessionFile(`0x${"66".repeat(32)}`)),
      new Date(),
    );
    const os = {
      mrtd: "11".repeat(48),
      rtmr0: "22".repeat(48),
      rtmr1: "33".repeat(48),
      rtmr2: "44".repeat(48),
    };
    const pins = {
      expectedComposeHash: "ab".repeat(32),
      expectedAppId: "cd".repeat(20),
      expectedOsMeasurements: os,
    };
    const tdx: EnclaveConfig = { ...config, attestationMode: "tdx", pins };
    await expect(connectEnclave(tdx, session, { fetch: fetchFn, warn: () => {} })).rejects.toMatchObject({
      code: "ATTESTATION_FAILED",
    });
  });
});
