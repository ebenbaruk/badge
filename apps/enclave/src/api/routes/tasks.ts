import type { Hono } from "hono";
import type { BadgeEnv } from "../../security/types";
import { CreateTaskSchema } from "../../tasks";
import { idParam, parseBody } from "../http";
import type { EnclaveServices } from "../services";

export function registerTaskRoutes(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  app.post("/v1/tasks", async (c) => {
    const input = await parseBody(c, CreateTaskSchema);
    return c.json(await services.tasks.createTask(c.get("caller"), input), 201);
  });

  app.get("/v1/tasks/:id", async (c) =>
    c.json(await services.tasks.getTask(c.get("caller"), idParam(c, "id"))),
  );
}
