import type { Me } from "@badge/client";
import type { Hono } from "hono";
import type { BadgeEnv } from "../../security/types";
import { jsonBody } from "../http";
import type { EnclaveServices } from "../services";

/**
 * Health and the two Ledger-signed bootstrap steps (enrollment, agent session), which authenticate themselves by
 * signature. The measurement route belongs to the security layer (src/security/routes.ts).
 */
export function registerPublicRoutes(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/v1/enroll", async (c) => c.json(await services.policy.enroll(await jsonBody(c)), 201));

  app.post("/v1/sessions", async (c) => c.json(await services.policy.openSession(await jsonBody(c)), 201));
}

/** GET /v1/me: who the session belongs to, as the directory knows them, and the tags of their own notes. */
export function registerMeRoute(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  app.get("/v1/me", (c) => {
    const { directory } = services.ctx;
    const employee = directory.requireEmployee(c.get("caller").employeeId);
    const contextTags = [
      ...new Set(services.inventory.notesOf(employee.id).flatMap((note) => note.tags)),
    ].sort();
    const me: Me = { ...directory.profile(employee), company: directory.company.name, contextTags };
    return c.json(me);
  });
}
