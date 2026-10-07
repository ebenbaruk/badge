import type { Hono } from "hono";
import { AuditQuerySchema, RegisterComplianceKeySchema, RevealNoticeSchema } from "../../compliance";
import { EnclaveError } from "../../errors";
import type { BadgeEnv } from "../../security/types";
import { parseBody } from "../http";
import type { EnclaveServices } from "../services";

export function registerComplianceRoutes(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  app.get("/v1/audit", (c) => {
    const query = AuditQuerySchema.safeParse(c.req.query());
    if (!query.success) throw new EnclaveError("INVALID_REQUEST", "afterSeq and limit must be integers");
    return c.json(services.compliance.readAudit(c.get("caller"), query.data));
  });

  app.get("/v1/compliance/key", (c) => c.json(services.compliance.currentKey(c.get("caller"))));

  app.post("/v1/compliance/key", async (c) => {
    const input = await parseBody(c, RegisterComplianceKeySchema);
    return c.json(await services.compliance.registerKey(c.get("caller"), input), 201);
  });

  app.post("/v1/audit/reveal-notice", async (c) => {
    const input = await parseBody(c, RevealNoticeSchema);
    return c.json(services.compliance.revealNotice(c.get("caller"), input), 201);
  });
}
