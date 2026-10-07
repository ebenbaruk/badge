/**
 * The Badge MCP server: four tools, described for an LLM in French and English, acting for one employee.
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
  "Badge est la mémoire confidentielle de l'entreprise (enclave TEE). Appelez badge_get_context au début d'une",
  "tâche pour obtenir le contexte utile (global et personnel) avec sa provenance. Le contexte personnel d'un collègue",
  "n'est remis qu'après sa signature sur son Ledger : si la réponse est en attente, reprenez avec badge_task_status.",
  "Badge is the company's confidential memory (TEE enclave). Call badge_get_context at the start of a task;",
  "a colleague's personal context is only released after they sign on their Ledger.",
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
      title: "Obtenir le contexte d'une tâche / Get context for a task",
      description: [
        "FR : Crée une tâche dans l'enclave Badge et renvoie le contexte autorisé (brief rédigé dans l'enclave et",
        "provenance de chaque extrait : entreprise, vous-même, accord signé, accord permanent). Si le contexte",
        "personnel d'un collègue est nécessaire, renvoie la liste des accords en attente (« en attente de l'accord de",
        "Bob sur son Ledger ») et l'identifiant de la tâche : rappelez alors badge_task_status plus tard.",
        "EN: Creates a task in the Badge enclave and returns the allowed context (enclave-drafted brief plus the",
        "provenance of each excerpt). If a colleague's personal context is needed, returns the pending consents",
        "(waiting for their approval on their Ledger) and the task id: call badge_task_status later.",
        "Some requests are refused by company rules (mass extraction): do not rephrase to get around them.",
      ].join("\n"),
      inputSchema: {
        task: z
          .string()
          .trim()
          .min(1)
          .max(MAX_TASK_CHARS)
          .describe(
            "Description complète de la tâche, en langage naturel (reste dans l'enclave). / Full task description.",
          ),
        taskLabel: z
          .string()
          .trim()
          .min(1)
          .max(MAX_TASK_LABEL_CHARS)
          .describe(
            "Libellé court, affiché sur le Ledger des propriétaires du contexte (ASCII, environ 40 caractères), " +
              "ex. « Brief rendez-vous Durand ». / Short label shown on the owners' Ledger.",
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input) => handlers.getContext(input),
  );

  server.registerTool(
    "badge_task_status",
    {
      title: "Statut d'une tâche / Task status",
      description: [
        "FR : Statut d'une tâche créée par badge_get_context ; renvoie le brief et sa provenance dès que plus aucun",
        "accord n'est en attente (un accord refusé ou expiré retire simplement l'extrait).",
        "EN: Status of a task created by badge_get_context; returns the brief and its provenance once no consent",
        "is pending anymore.",
      ].join("\n"),
      inputSchema: {
        taskId: z
          .string()
          .regex(BYTES32_HEX, { error: "taskId must be 0x + 32 bytes of hex" })
          .describe(
            "Identifiant renvoyé par badge_get_context (0x + 64 hex). / Task id from badge_get_context.",
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (input) => handlers.taskStatus(input),
  );

  server.registerTool(
    "badge_list_my_consents",
    {
      title: "Demandes d'accord qui me sont adressées / Consent requests addressed to me",
      description: [
        "FR : Liste les demandes de partage du contexte personnel de l'employé (qui demande quoi, pour quelle",
        "tâche, niveau de risque). L'agent ne peut pas approuver : l'employé signe sur son Ledger dans l'app web.",
        "EN: Lists requests to share the employee's personal context (who asks for what, for which task, risk).",
        "The agent cannot approve them: the employee signs on their Ledger in the web app.",
      ].join("\n"),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => handlers.listMyConsents(),
  );

  server.registerTool(
    "badge_attestation",
    {
      title: "Attestation de l'enclave / Enclave attestation",
      description: [
        "FR : Mesure de l'enclave Badge et résumé de son attestation (TDX vérifiée ou simulée, compose hash,",
        "statut TCB), comparée à la mesure que l'employé a signée pour cette session.",
        "EN: Badge enclave measurement and attestation summary (verified TDX or simulated, compose hash, TCB",
        "status), compared with the measurement the employee signed for this session.",
      ].join("\n"),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () => handlers.attestation(),
  );

  return server;
}
