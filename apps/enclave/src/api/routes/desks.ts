import { signatureSchema } from "@badge/consent";
import type { Hono } from "hono";
import type { Hex } from "viem";
import { z } from "zod";
import { CreateDeskRequestSchema } from "../../desks";
import type { BadgeEnv } from "../../security/types";
import { idParam, jsonBody, parseBody } from "../http";
import type { EnclaveServices } from "../services";

/** The proof is validated by @badge/zk (decodeDeskProof), with its own error codes. */
const ApproveDeskShareSchema = z.strictObject({ signature: signatureSchema, proof: z.unknown() });

export function registerDeskRoutes(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  app.post("/v1/desks/join", async (c) =>
    c.json(await services.desks.join(c.get("caller"), await jsonBody(c)), 201),
  );

  app.get("/v1/desks/:desk", (c) => c.json(services.desks.getDesk(c.req.param("desk"))));

  app.post("/v1/desk-requests", async (c) => {
    const input = await parseBody(c, CreateDeskRequestSchema);
    return c.json(await services.desks.createRequest(c.get("caller"), input), 201);
  });

  app.get("/v1/desk-requests/:id", (c) =>
    c.json(services.desks.getRequest(c.get("caller"), idParam(c, "id"))),
  );

  app.post("/v1/desk-requests/:id/approve", async (c) => {
    const { signature, proof } = await parseBody(c, ApproveDeskShareSchema);
    return c.json(await services.desks.approve(c.get("caller"), idParam(c, "id"), signature as Hex, proof));
  });

  app.post("/v1/desk-requests/:id/reject", (c) =>
    c.json(services.desks.reject(c.get("caller"), idParam(c, "id"))),
  );
}
