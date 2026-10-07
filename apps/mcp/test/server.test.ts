import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startHttpServer, type HttpServerHandle } from "../src/http";
import { createBadgeMcpServer } from "../src/server";
import type { ToolDeps } from "../src/tools";
import { FakeBadgeApi, SESSION, TASK_ID } from "./fixtures";

const TOOL_NAMES = ["badge_attestation", "badge_get_context", "badge_list_my_consents", "badge_task_status"];

function textOf(result: unknown): string {
  return (result as CallToolResult).content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

describe("MCP server (in-process client)", () => {
  let api: FakeBadgeApi;
  let client: Client;

  beforeEach(async () => {
    api = new FakeBadgeApi();
    const deps: ToolDeps = { api, session: SESSION, enclaveTransport: "channel" };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createBadgeMcpServer(deps).connect(serverTransport);
    client = new Client({ name: "test-harness", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  it("lists the four tools with bilingual descriptions and input schemas", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOL_NAMES);
    for (const tool of tools) {
      expect(tool.description).toMatch(/FR :/);
      expect(tool.description).toMatch(/EN:/);
    }
    const getContext = tools.find((tool) => tool.name === "badge_get_context");
    expect(getContext?.inputSchema.required).toEqual(["task", "taskLabel"]);
    expect(getContext?.annotations?.readOnlyHint).toBe(false);
  });

  it("calls badge_get_context and badge_task_status end to end", async () => {
    const pending = await client.callTool({
      name: "badge_get_context",
      arguments: { task: "Preparer le rendez-vous Durand", taskLabel: "Brief Durand" },
    });
    expect(textOf(pending)).toContain("En attente de l'accord de Bob Durand");

    const ready = await client.callTool({ name: "badge_task_status", arguments: { taskId: TASK_ID } });
    expect(textOf(ready)).toContain("## Brief (rédigé dans l'enclave)");
  });

  it("rejects invalid arguments before reaching the enclave", async () => {
    const result = (await client.callTool({
      name: "badge_task_status",
      arguments: { taskId: "not-a-task-id" },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("taskId must be 0x + 32 bytes of hex");
    expect(api.calls).toEqual([]);
  });

  it("calls the argument-less tools", async () => {
    expect(textOf(await client.callTool({ name: "badge_list_my_consents", arguments: {} }))).toContain(
      "Alice Martin (Ventes)",
    );
    expect(textOf(await client.callTool({ name: "badge_attestation", arguments: {} }))).toContain(
      "Mesure de l'enclave",
    );
  });
});

describe("MCP server over Streamable HTTP", () => {
  let http: HttpServerHandle;
  const errors: unknown[] = [];

  beforeEach(async () => {
    const deps: ToolDeps = { api: new FakeBadgeApi(), session: SESSION, enclaveTransport: "channel" };
    http = await startHttpServer(
      () => createBadgeMcpServer(deps),
      0,
      (error) => errors.push(error),
    );
  });

  afterEach(async () => {
    await http.close();
  });

  it("serves the tools on the loopback interface", async () => {
    expect(http.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = new Client({ name: "test-harness", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOL_NAMES.length);
    expect(textOf(await client.callTool({ name: "badge_list_my_consents", arguments: {} }))).toContain(
      "en attente",
    );
    await client.close();
    expect(errors).toEqual([]);
  });

  it("refuses browser requests and foreign Host headers", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };

    const fromBrowser = await fetch(http.url, {
      method: "POST",
      body,
      headers: { ...headers, origin: "https://evil.example" },
    });
    expect(fromBrowser.status).toBe(403);

    // fetch silently drops a custom Host header: send the rebinding attempt with node:http.
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        http.url,
        { method: "POST", headers: { ...headers, host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
    expect(reboundStatus).toBe(403);

    expect((await fetch(http.url, { method: "GET" })).status).toBe(405);
  });
});
