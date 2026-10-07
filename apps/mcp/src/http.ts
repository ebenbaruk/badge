/**
 * Optional Streamable HTTP transport, for harnesses that prefer a URL to spawning a process. Stateless: each POST
 * gets a fresh MCP server and transport (the SDK's stateless pattern), all sharing the one BadgeClient, so the
 * attested channel and its request ordering stay in a single place.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MCP_HTTP_HOST, MCP_HTTP_PATH } from "./config";

const HTTP_FORBIDDEN = 403;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;
/** JSON-RPC "internal error". */
const JSON_RPC_INTERNAL_ERROR = -32603;

export interface HttpServerHandle {
  readonly url: string;
  close(): Promise<void>;
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: JSON_RPC_INTERNAL_ERROR, message }, id: null }));
}

/**
 * Listens on 127.0.0.1 only (see MCP_HTTP_HOST) with DNS-rebinding protection, so a web page in the employee's
 * browser cannot drive their agent session through `http://evil.example` resolving to 127.0.0.1.
 * @param port 0 picks a free port (tests).
 */
export async function startHttpServer(
  createMcpServer: () => McpServer,
  port: number,
  onError: (error: unknown) => void,
): Promise<HttpServerHandle> {
  let allowedHosts: string[] = [];

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? "/", `http://${MCP_HTTP_HOST}`).pathname;
    if (path !== MCP_HTTP_PATH) return sendJsonRpcError(res, HTTP_NOT_FOUND, "not found");
    // Stateless: no session to resume (GET stream) or terminate (DELETE).
    if (req.method !== "POST") return sendJsonRpcError(res, HTTP_METHOD_NOT_ALLOWED, "method not allowed");
    // Agent harnesses are not browsers: any Origin header means a web page is trying to reach the loopback port.
    if (req.headers.origin !== undefined)
      return sendJsonRpcError(res, HTTP_FORBIDDEN, "browser origin refused");
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };

  const httpServer: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      onError(error);
      sendJsonRpcError(res, HTTP_INTERNAL_ERROR, "internal error");
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, MCP_HTTP_HOST, () => resolve());
  });
  const actualPort = (httpServer.address() as AddressInfo).port;
  allowedHosts = [`${MCP_HTTP_HOST}:${actualPort}`, `localhost:${actualPort}`];

  return {
    url: `http://${MCP_HTTP_HOST}:${actualPort}${MCP_HTTP_PATH}`,
    close: () => new Promise<void>((resolve, reject) => httpServer.close((e) => (e ? reject(e) : resolve()))),
  };
}
