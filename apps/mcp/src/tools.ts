/**
 * Tool handlers, independent of the MCP transport: each one calls the enclave through the employee's BadgeClient
 * and renders the answer for the LLM. Enclave refusals become MCP tool errors (`isError`), so the model sees why it
 * was refused instead of a protocol failure.
 */
import { BadgeApiError, type BadgeClient } from "@badge/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAttestation, formatConsents, formatTask, type SessionSummary } from "./format";

/** The part of {@link BadgeClient} the tools use (a fake implements it in tests). */
export type BadgeAgentApi = Pick<
  BadgeClient,
  "createTask" | "getTask" | "listConsents" | "measurement" | "connect" | "attestation"
>;

export interface ToolDeps {
  readonly api: BadgeAgentApi;
  readonly session: SessionSummary;
  /** `plain` = local development without attested channel (no attestation to show). */
  readonly enclaveTransport: "channel" | "plain";
}

/** Inputs, validated by the MCP server against the schemas in server.ts before reaching a handler. */
export interface GetContextInput {
  task: string;
  taskLabel: string;
}
export interface TaskStatusInput {
  taskId: string;
}

export interface ToolHandlers {
  getContext(input: GetContextInput): Promise<CallToolResult>;
  taskStatus(input: TaskStatusInput): Promise<CallToolResult>;
  listMyConsents(): Promise<CallToolResult>;
  attestation(): Promise<CallToolResult>;
}

/** Extra guidance for the model on the refusals it can do something about. */
const ERROR_HINTS: Readonly<Record<string, string>> = {
  session_unknown:
    "La session de l'agent est expirée, révoquée ou inconnue : l'employé doit en signer une nouvelle sur son Ledger.",
  attestation_failed: "L'enclave n'a pas pu être attestée : n'envoyez aucune donnée, prévenez l'employé.",
  NOT_FOUND: "Identifiant inconnu (ou tâche d'un autre employé).",
  network_error: "Enclave injoignable : réessayez plus tard.",
};

function text(content: string): CallToolResult {
  return { content: [{ type: "text", text: content }] };
}

function refusal(error: BadgeApiError): CallToolResult {
  const hint = ERROR_HINTS[error.code];
  const status = error.status === 0 ? "" : `, HTTP ${error.status}`;
  const lines = [`Refus de Badge (${error.code}${status}) : ${error.message}`];
  if (hint !== undefined) lines.push(hint);
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
}

/** Runs a handler body; only typed Badge refusals are turned into tool errors, anything else propagates. */
async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof BadgeApiError) return refusal(error);
    throw error;
  }
}

/** Builds the four tool handlers acting for the session's employee. */
export function createToolHandlers(deps: ToolDeps): ToolHandlers {
  const { api } = deps;
  return {
    getContext: (input) =>
      guarded(async () => {
        const created = await api.createTask({ task: input.task, taskLabel: input.taskLabel });
        // The brief is drafted on the first read once nothing is pending: fetch it now rather than make the model
        // call twice for the common case where everything is already allowed.
        const task = created.status === "ready" ? await api.getTask(created.id) : created;
        return text(formatTask(task));
      }),
    taskStatus: (input) => guarded(async () => text(formatTask(await api.getTask(input.taskId)))),
    listMyConsents: () => guarded(async () => text(formatConsents(await api.listConsents()))),
    attestation: () =>
      guarded(async () => {
        if (deps.enclaveTransport === "plain") {
          const { measurement, composeHash, appId } = await api.measurement();
          return text(
            [
              "Transport HTTP direct (développement) : l'enclave n'est PAS attestée.",
              `- Mesure annoncée : ${measurement}`,
              `- Compose hash annoncé : ${composeHash}`,
              `- App id : ${appId}`,
            ].join("\n"),
          );
        }
        return text(formatAttestation(api.attestation ?? (await api.connect()), deps.session));
      }),
  };
}
