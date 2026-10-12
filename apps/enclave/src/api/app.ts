/**
 * The enclave's HTTP API (Hono), with the wire shapes of packages/client/src/api-schemas.ts. Every dependency is injected, so the
 * whole API runs in-process in tests (app.request) and behind the attested channel in production (the channel
 * dispatches decrypted requests to this same app).
 *
 * Layering: the security layer (src/security) is mounted first and owns everything about the transport and the
 * caller (attested channel, request signatures, replay, body limits, the measurement route); the domain routes
 * registered after it only ever see authenticated requests (`c.var.caller`), except the self-authenticating ones.
 */
import { Hono } from "hono";
import type { Hex } from "viem";
import { SessionRepository } from "../policy";
import { mountSecurityRoutes, type SecurityHandle, type SessionResolver } from "../security";
import type { BadgeEnv } from "../security/types";
import { toErrorResponse, upstreamDiagnostic } from "./errors";
import { registerComplianceRoutes } from "./routes/compliance";
import { registerConsentRoutes } from "./routes/consents";
import { registerDeskRoutes } from "./routes/desks";
import { registerMeRoute, registerPublicRoutes } from "./routes/identity";
import { registerTaskRoutes } from "./routes/tasks";
import { createServices, type AppDeps, type EnclaveServices } from "./services";

function defaultUnexpectedErrorLogger(error: unknown): void {
  // Name only: an unexpected error message could quote internal data (excerpt text, model output).
  console.error(`[enclave] unexpected ${error instanceof Error ? error.name : typeof error}`);
}

/**
 * CVM logs are off by design, but the operator still needs to know which backend call breaks a request: one line
 * per failure, content-free (see upstreamDiagnostic), readable with `docker logs` in a local rehearsal or when
 * logs are enabled.
 */
function defaultUpstreamFailureLogger(route: string, diagnostic: string): void {
  console.error(`[enclave] upstream failure on ${route}: ${diagnostic}`);
}

export interface EnclaveApp {
  readonly app: Hono<BadgeEnv>;
  readonly services: EnclaveServices;
  readonly security: SecurityHandle;
  /** The bytes32 every signed message must carry (compose hash read from dstack). */
  readonly measurement: Hex;
}

/**
 * Builds the API: security layer, then domain routes. Async because the measurement the domain checks signed
 * messages against is read from dstack first (fails here, at boot, rather than on the first request).
 */
export async function createEnclaveApp(deps: AppDeps): Promise<EnclaveApp> {
  const app = new Hono<BadgeEnv>();
  const onUnexpected = deps.onUnexpectedError ?? defaultUnexpectedErrorLogger;
  const onUpstreamFailure = deps.onUpstreamFailure ?? defaultUpstreamFailureLogger;
  app.onError((error, c) => {
    const { status, body } = toErrorResponse(error);
    if (status >= 500 && body.error.code === "INTERNAL") onUnexpected(error);
    const diagnostic = upstreamDiagnostic(error);
    // The route pattern, not the path: ids in the path are not needed to diagnose a backend failure.
    if (diagnostic !== undefined) onUpstreamFailure(`${c.req.method} ${c.req.routePath}`, diagnostic);
    return c.json(body, status);
  });
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: `no route ${c.req.method} ${c.req.path}` } }, 404),
  );

  const sessionRepository = new SessionRepository(deps.db);
  const sessions: SessionResolver = {
    resolve: async (sessionKey) =>
      sessionRepository.findActiveCaller(sessionKey, deps.clock.now().getTime()) ?? null,
  };
  const security = mountSecurityRoutes(app, {
    dstack: deps.dstack,
    sessions,
    clock: { now: () => deps.clock.now().getTime() },
    requireChannel: deps.requireChannel,
  });
  const { measurement } = await security.identity.read();
  const services = createServices(deps, { measurement });

  registerPublicRoutes(app, services);
  registerMeRoute(app, services);
  registerTaskRoutes(app, services);
  registerConsentRoutes(app, services);
  registerDeskRoutes(app, services);
  registerComplianceRoutes(app, services);
  return { app, services, security, measurement };
}
