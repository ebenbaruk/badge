/**
 * The enclave's HTTP API (Hono), exactly as described in docs/enclave-api.md. `createApp` is pure: every
 * dependency is injected, so the whole API runs in-process in tests (app.request) and behind the attested channel
 * in production (the channel dispatches decrypted requests to this same app).
 */
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { BadgeEnv } from "../security/types";
import { toErrorResponse } from "./errors";
import { registerComplianceRoutes } from "./routes/compliance";
import { registerConsentRoutes } from "./routes/consents";
import { registerDeskRoutes } from "./routes/desks";
import { registerMeRoute, registerPublicRoutes } from "./routes/identity";
import { registerTaskRoutes } from "./routes/tasks";
import { createServices, type AppDeps, type EnclaveServices } from "./services";

/** Largest accepted request body. A desk proof plus signature is ~2 KB; tasks are capped at 2,000 characters. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Routes under /v1 that authenticate themselves (by Ledger signature or attestation), not by session. */
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  "/v1/enroll",
  "/v1/sessions",
  "/v1/attestation/measurement",
]);
/** The attested channel (src/security) carries its own handshake; requests it unwraps are authenticated inside. */
export const CHANNEL_PATH_PREFIX = "/v1/channel/";

function defaultUnexpectedErrorLogger(error: unknown): void {
  // Name only: an unexpected error message could quote internal data (excerpt text, model output).
  console.error(`[enclave] unexpected ${error instanceof Error ? error.name : typeof error}`);
}

/**
 * Builds the API. Pass `services` to share them with boot code (e.g. {@link prepareEnclaveState}); by default they
 * are created from `deps`.
 */
export function createApp(deps: AppDeps, services: EnclaveServices = createServices(deps)): Hono<BadgeEnv> {
  const app = new Hono<BadgeEnv>();
  const onUnexpected = deps.onUnexpectedError ?? defaultUnexpectedErrorLogger;

  app.onError((error, c) => {
    const { status, body } = toErrorResponse(error);
    if (status >= 500 && body.error.code === "INTERNAL") onUnexpected(error);
    return c.json(body, status);
  });
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: `no route ${c.req.method} ${c.req.path}` } }, 404),
  );

  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json({ error: { code: "BODY_TOO_LARGE", message: `body exceeds ${MAX_BODY_BYTES} bytes` } }, 413),
    }),
  );
  // One middleware with an explicit allow-list rather than per-route registration: a new route is authenticated by
  // default, and the authenticator never runs twice on one request (its replay cache would reject the second run).
  const authenticate: MiddlewareHandler<BadgeEnv> = async (c, next) => {
    const path = c.req.path;
    if (PUBLIC_API_PATHS.has(path) || path.startsWith(CHANNEL_PATH_PREFIX)) return next();
    return deps.authenticate(c, next);
  };
  app.use("/v1/*", authenticate);

  registerPublicRoutes(app, services);
  registerMeRoute(app, services);
  registerTaskRoutes(app, services);
  registerConsentRoutes(app, services);
  registerDeskRoutes(app, services);
  registerComplianceRoutes(app, services);
  return app;
}
