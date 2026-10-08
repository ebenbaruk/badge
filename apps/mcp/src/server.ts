/**
 * The Badge MCP server: four tools, described for an LLM, acting for one employee.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createToolHandlers, type ToolDeps } from "./tools";

export const MCP_SERVER_NAME = "badge";
export const MCP_SERVER_VERSION = "0.1.0";

/** Limits of `POST /v1/tasks` (apps/enclave CreateTaskSchema); checked here so the model gets a precise error. */
export const MAX_TASK_CHARS = 2000;
export const MAX_TASK_LABEL_CHARS = 200;
const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;

const INSTRUCTIONS = [
  "Badge is the company's confidential memory (TEE enclave). Call badge_get_context at the start of a task to get",
  "the relevant context (company and personal) with its provenance. A colleague's personal context is only released",
  "after they sign on their Ledger: if the answer is pending, follow up with badge_task_status.",
].join("\n");

/** Creates the server; `deps.api` is the employee's authenticated BadgeClient (or a fake in tests). */
export function createBadgeMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  const handlers = createToolHandlers(deps);

  server.registerTool(
    "badge_get_context",
    {
      title: "Get context for a task",
      description: [
        "Creates a task in the Badge enclave and returns the allowed context: a brief drafted in the enclave plus the",
        "provenance of each excerpt (company, yourself, signed consent, standing agreement). If a colleague's personal",
        'context is needed, returns the pending consents ("waiting for Bob\'s consent on his Ledger") and the task id:',
        "call badge_task_status later.",
        "Some requests are refused by company rules (mass extraction): do not rephrase to get around them.",
      ].join("\n"),
      inputSchema: {
        task: z
          .string()
          .trim()
          .min(1)
          .max(MAX_TASK_CHARS)
          .describe("Full task description, in natural language (stays in the enclave)."),
        taskLabel: z
          .string()
          .trim()
          .min(1)
          .max(MAX_TASK_LABEL_CHARS)
          .describe(
            "Short label shown on the context owners' Ledger (ASCII, about 40 characters), " +
              'e.g. "Brief for Orion meeting".',
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input) => handlers.getContext(input),
  );

  server.registerTool(
    "badge_task_status",
    {
      title: "Task status",
      description: [
        "Status of a task created by badge_get_context; returns the brief and its provenance once no consent is",
        "pending anymore (a rejected or expired consent simply drops that excerpt).",
      ].join("\n"),
      inputSchema: {
        taskId: z
          .string()
          .regex(BYTES32_HEX, { error: "taskId must be 0x + 32 bytes of hex" })
          .describe("Task id returned by badge_get_context (0x + 64 hex)."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (input) => handlers.taskStatus(input),
  );

  server.registerTool(
    "badge_list_my_consents",
    {
      title: "Consent requests addressed to me",
      description: [
        "Lists requests to share the employee's personal context (who asks for what, for which task, risk).",
        "The agent cannot approve them: the employee signs on their Ledger in the web app.",
      ].join("\n"),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => handlers.listMyConsents(),
  );

  server.registerTool(
    "badge_attestation",
    {
      title: "Enclave attestation",
      description: [
        "Badge enclave measurement and attestation summary (verified TDX or simulated, compose hash, TCB",
        "status), compared with the measurement the employee signed for this session.",
      ].join("\n"),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => handlers.attestation(),
  );

  return server;
}
