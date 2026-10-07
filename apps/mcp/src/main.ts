/**
 * Entry point: `tsx apps/mcp/src/main.ts [--session <file>] [--http] [--port <n>]`.
 * Everything goes to stderr: on stdio, stdout carries the MCP protocol and nothing else.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadMcpConfig } from "./config";
import { connectEnclave } from "./enclave";
import { McpSetupError } from "./errors";
import type { SessionSummary } from "./format";
import { startHttpServer } from "./http";
import { createBadgeMcpServer } from "./server";
import { readSessionFile, requireUsableSession } from "./session-file";
import type { ToolDeps } from "./tools";

const log = (message: string) => console.error(`badge-mcp: ${message}`);

async function main(): Promise<void> {
  const config = loadMcpConfig();
  const session = requireUsableSession(await readSessionFile(config.sessionFile), new Date());
  const api = await connectEnclave(config, session, { warn: log });
  const summary: SessionSummary = {
    employee: session.message.employee,
    agentName: session.message.agentName,
    enclaveMeasurement: session.message.enclaveMeasurement,
    expiresAt: session.message.expiresAt,
  };
  const deps: ToolDeps = { api, session: summary, enclaveTransport: config.enclaveTransport };
  const attested = api.attestation?.ok === true ? `attested (${config.attestationMode})` : "not attested yet";
  log(`acting for ${summary.employee} as "${summary.agentName}", enclave ${config.enclaveUrl} ${attested}`);

  if (config.mcpTransport === "http") {
    const http = await startHttpServer(
      () => createBadgeMcpServer(deps),
      config.httpPort,
      (error) => log(`request failed: ${(error as Error).message}`),
    );
    log(`Streamable HTTP on ${http.url}`);
    return;
  }
  await createBadgeMcpServer(deps).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  if (error instanceof McpSetupError) log(`${error.code}: ${error.message}`);
  else log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
