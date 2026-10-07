/**
 * Security routes and middlewares of the enclave API:
 * - `POST /v1/channel/open`: attested handshake (quote over the client's nonce and both channel keys);
 * - `POST /v1/channel/:id`: a sealed inner request, dispatched in-process to the same app, answered sealed;
 * - `GET /v1/attestation/measurement`: the enclave measurement signed messages must carry;
 * - request authentication on every other `/v1` route, and optionally a guard refusing plain `/v1` calls.
 */
import { AttestError, EnclaveChannel } from "@badge/attest";
import { createAttestationBundle, deriveChannelKeyPair, type DstackAgent } from "@badge/attest/server";
import {
  CHANNEL_PATHS,
  channelMessageRequestSchema,
  channelOpenRequestSchema,
  INNER_REQUEST_HEADERS,
  innerRequestSchema,
  MAX_CHANNEL_BODY_LENGTH,
  type ChannelOpenResponse,
  type InnerRequest,
  type InnerResponse,
} from "@badge/client";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { createAuthMiddleware, type AuthMiddlewareOptions, type SessionResolver } from "./auth";
import { ChannelTable } from "./channel-table";
import type { Clock } from "./clock";
import { SecurityError, securityErrorResponse } from "./errors";
import { EnclaveIdentity } from "./measurement";
import type { BadgeEnv } from "./types";

/** Origin of in-process requests: never resolved, it only gives `app.request` an absolute URL. */
const INTERNAL_ORIGIN = "http://enclave.internal";
/** Outer bodies: a sealed inner request is hex, so about twice its plaintext, plus the envelope. */
const MAX_OUTER_BODY_BYTES = 2 * MAX_CHANNEL_BODY_LENGTH + 4096;

export interface SecurityDeps {
  /** dstack guest agent (real socket in the CVM, simulator locally): `createDstackClient()`. */
  dstack: DstackAgent;
  /** Domain implementation of session lookup. */
  sessions: SessionResolver;
  clock: Clock;
  /**
   * Production: refuse `/v1` calls that do not come through the attested channel (`CHANNEL_REQUIRED`, 403), since
   * on Phala TLS ends at the gateway. Local development can leave it off to call routes with plain HTTP.
   */
  requireChannel?: boolean;
  channelIdleTtlMs?: number;
  maxChannels?: number;
  auth?: AuthMiddlewareOptions;
}

/** What the security layer exposes to the domain. */
export interface SecurityHandle {
  /** Enclave identity (cached), e.g. to check `enclaveMeasurement` in signed messages. */
  identity: EnclaveIdentity;
  channels: ChannelTable;
}

async function readJsonBody<T>(c: Context, schema: z.ZodType<T>, what: string): Promise<T> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch (error) {
    throw new SecurityError("INVALID_BODY", 400, `${what}: body is not JSON`, { cause: error });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new SecurityError("INVALID_BODY", 400, `${what}: ${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function toInnerHttpRequest(inner: InnerRequest): Request {
  const headers = new Headers();
  for (const name of INNER_REQUEST_HEADERS) {
    const value = inner.headers[name];
    if (value !== undefined) headers.set(name, value);
  }
  return new Request(`${INTERNAL_ORIGIN}${inner.path}`, {
    method: inner.method,
    headers,
    ...(inner.body === null || inner.method === "GET" ? {} : { body: inner.body }),
  });
}

async function toInnerResponse(response: Response): Promise<InnerResponse> {
  const body = await response.text();
  if (body.length > MAX_CHANNEL_BODY_LENGTH) {
    return {
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "response_too_large", message: "response exceeds the channel limit" },
      }),
    };
  }
  return { status: response.status, contentType: response.headers.get("content-type"), body };
}

/**
 * Mounts the security layer on `app`. Call it BEFORE registering the domain routes: Hono runs middlewares in
 * registration order, and authentication must wrap every `/v1` route (new routes are then protected by default).
 */
export function mountSecurityRoutes(app: Hono<BadgeEnv>, deps: SecurityDeps): SecurityHandle {
  const channels = new ChannelTable(deps.clock, deps.channelIdleTtlMs, deps.maxChannels);
  const identity = new EnclaveIdentity(deps.dstack);
  /** Requests created by the channel dispatcher: an object identity the network cannot forge. */
  const viaChannel = new WeakSet<Request>();
  let channelKey: Promise<{ secretKey: Uint8Array }> | undefined;
  const channelSecretKey = async () => {
    channelKey ??= deriveChannelKeyPair(deps.dstack).catch((error: unknown) => {
      channelKey = undefined;
      throw error;
    });
    return (await channelKey).secretKey;
  };

  // First, while `c.req.raw` is still the object the dispatcher created (bodyLimit may wrap the request).
  if (deps.requireChannel) {
    app.use("/v1/*", async (c, next) => {
      const path = c.req.path;
      const exempt = path.startsWith(CHANNEL_PATHS.prefix) || path === "/v1/attestation/measurement";
      if (exempt || viaChannel.has(c.req.raw)) return next();
      return securityErrorResponse(
        c,
        new SecurityError(
          "CHANNEL_REQUIRED",
          403,
          "this enclave only accepts requests through the attested channel",
        ),
      );
    });
  }

  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: MAX_OUTER_BODY_BYTES,
      onError: (c) =>
        securityErrorResponse(c, new SecurityError("BODY_TOO_LARGE", 413, "request body is too large")),
    }),
  );

  app.use("/v1/*", createAuthMiddleware(deps.sessions, deps.clock, deps.auth));

  /** Maps security and attestation failures to the API error format; anything else is a bug for `onError`. */
  const guarded = (handler: (c: Context<BadgeEnv>) => Promise<Response>) => async (c: Context<BadgeEnv>) => {
    try {
      return await handler(c);
    } catch (error) {
      if (error instanceof SecurityError) return securityErrorResponse(c, error);
      if (error instanceof AttestError) {
        const status = error.code === "DSTACK_FAILED" ? 503 : 400;
        const code = error.code === "DSTACK_FAILED" ? "DSTACK_FAILED" : "CHANNEL_REJECTED";
        return securityErrorResponse(c, new SecurityError(code, status, error.message, { cause: error }));
      }
      throw error;
    }
  };

  app.post(
    CHANNEL_PATHS.open,
    guarded(async (c) => {
      const hello = await readJsonBody(c, channelOpenRequestSchema, "channel hello");
      const channel = EnclaveChannel.accept(hello, await channelSecretKey());
      // Refuse a re-used handshake before paying for a quote (see ChannelTable.add).
      if (channels.has(channel.channelId)) {
        throw new SecurityError("CHANNEL_EXISTS", 409, "this handshake was already used: open a new channel");
      }
      const bundle = await createAttestationBundle(deps.dstack, { ...hello, enclavePk: channel.enclavePk });
      channels.add(channel);
      const response: ChannelOpenResponse = {
        channelId: channel.channelId,
        enclavePk: channel.enclavePk,
        bundle,
      };
      return c.json(response);
    }),
  );

  app.post(
    `${CHANNEL_PATHS.prefix}:channelId`,
    guarded(async (c) => {
      const { sealed } = await readJsonBody(c, channelMessageRequestSchema, "channel message");
      const channelId = c.req.param("channelId") ?? "";
      if (sealed.channelId !== channelId) {
        throw new SecurityError("CHANNEL_REJECTED", 400, "sealed message belongs to another channel");
      }
      const channel = channels.get(channelId);
      // Throws ChannelError (an AttestError) on tampering, replay or a malformed inner request.
      const inner = channel.open(sealed, innerRequestSchema);
      const request = toInnerHttpRequest(inner);
      viaChannel.add(request);
      const response = await app.request(request);
      return c.json({ sealed: channel.seal(await toInnerResponse(response)) });
    }),
  );

  app.get(
    "/v1/attestation/measurement",
    guarded(async (c) => c.json(await identity.read())),
  );

  return { identity, channels };
}
