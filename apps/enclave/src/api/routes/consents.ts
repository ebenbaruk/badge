import type { ConsentListWire } from "@badge/client";
import { signatureSchema } from "@badge/consent";
import type { Hono } from "hono";
import type { Hex } from "viem";
import { z } from "zod";
import type { BadgeEnv } from "../../security/types";
import { idParam, jsonBody, parseBody } from "../http";
import type { EnclaveServices } from "../services";

const ApproveConsentSchema = z.strictObject({ signature: signatureSchema });

/** Owner-side routes: pending requests, decisions, grants, standing policies and revocations. */
export function registerConsentRoutes(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  /** Everything waiting for the caller's Ledger: one-off shares (with risk flags) and anonymous desk shares. */
  app.get("/v1/consents", (c) => {
    const caller = c.get("caller");
    const list: ConsentListWire = {
      consents: [...services.policy.pendingConsents(caller), ...services.desks.pendingShares(caller)],
    };
    return c.json(list);
  });

  app.post("/v1/consents/:id/approve", async (c) => {
    const { signature } = await parseBody(c, ApproveConsentSchema);
    return c.json(await services.policy.approveConsent(c.get("caller"), idParam(c, "id"), signature as Hex));
  });

  app.post("/v1/consents/:id/reject", (c) =>
    c.json(services.policy.rejectConsent(c.get("caller"), idParam(c, "id"))),
  );

  app.get("/v1/grants", (c) => c.json({ grants: services.policy.activeGrants(c.get("caller")) }));

  app.post("/v1/policies", async (c) =>
    c.json(await services.policy.createPolicy(c.get("caller"), await jsonBody(c)), 201),
  );

  app.get("/v1/policies", (c) => c.json({ policies: services.policy.listPolicies(c.get("caller")) }));

  app.post("/v1/revocations", async (c) =>
    c.json(await services.policy.revoke(c.get("caller"), await jsonBody(c)), 201),
  );
}
