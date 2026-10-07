import type { Hono } from "hono";
import type { BadgeEnv } from "../../security/types";
import { jsonBody } from "../http";
import type { EnclaveServices } from "../services";

/**
 * Public routes (no session): health, the measurement clients pin their signatures to, and the two
 * Ledger-signed bootstrap steps (enrollment, agent session), which authenticate themselves by signature.
 */
export function registerPublicRoutes(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/v1/attestation/measurement", (c) => c.json({ measurement: services.ctx.enclave.measurement }));

  app.post("/v1/enroll", async (c) => c.json(await services.policy.enroll(await jsonBody(c)), 201));

  app.post("/v1/sessions", async (c) => c.json(await services.policy.openSession(await jsonBody(c)), 201));
}

/** GET /v1/me: who the session belongs to, as the directory knows them. */
export function registerMeRoute(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  app.get("/v1/me", (c) => {
    const employee = services.ctx.directory.requireEmployee(c.get("caller").employeeId);
    return c.json({
      employeeId: employee.id,
      name: employee.name,
      team: employee.team,
      role: employee.role,
      address: employee.address,
      desks: employee.desks,
      company: services.ctx.directory.company.name,
    });
  });
}
