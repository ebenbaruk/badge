/**
 * Request authentication: every API call (except the public routes below) is signed by an agent session key with
 * EIP-191 over `canonicalRequest` (format owned by `@badge/client`, so client and enclave cannot drift apart).
 * The session is resolved through the domain's {@link SessionResolver}; the security layer never reads storage.
 */
import { BADGE_AUTH_HEADERS, canonicalRequest, MAX_REQUEST_SKEW_MS } from "@badge/client";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import {
  getAddress,
  isAddress,
  isAddressEqual,
  recoverMessageAddress,
  sha256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import type { Clock } from "./clock";
import { SecurityError, securityErrorResponse } from "./errors";
import { ReplayCache } from "./replay-cache";
import type { BadgeEnv, Caller } from "./types";

/** Implemented by the domain: maps a session key to its employee, or null when unknown, expired or revoked. */
export interface SessionResolver {
  resolve(sessionKey: Address): Promise<Caller | null>;
}

/** Requests are small JSON documents; anything bigger is refused before hashing. */
export const MAX_AUTHENTICATED_BODY_BYTES = 256 * 1024;
/**
 * Upper bound of requests remembered for replay detection (each lives `2 * MAX_REQUEST_SKEW_MS` at most). Far above
 * what a company's agents send in two minutes; reaching it makes the enclave refuse calls rather than forget.
 */
export const DEFAULT_REPLAY_CACHE_CAPACITY = 100_000;

const TIMESTAMP_PATTERN = /^[1-9][0-9]{0,15}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

/**
 * Routes reachable without a session signature: health, enclave identity, the channel (it carries signed inner
 * requests), and the two onboarding routes whose bodies are Ledger-signed messages verified by the domain.
 */
export function isPublicRoute(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  if (upper === "GET" && (path === "/health" || path === "/v1/attestation/measurement")) return true;
  if (upper !== "POST") return false;
  return path === "/v1/enroll" || path === "/v1/sessions" || path.startsWith("/v1/channel/");
}

export interface AuthMiddlewareOptions {
  replayCacheCapacity?: number;
}

function header(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new SecurityError("auth_missing", 401, `missing ${name} header`);
  }
  return value;
}

async function authenticate(
  request: Request,
  pathWithQuery: string,
  body: Uint8Array,
  clock: Clock,
  replays: ReplayCache,
  resolver: SessionResolver,
): Promise<Caller> {
  const session = header(
    request.headers.get(BADGE_AUTH_HEADERS.session) ?? undefined,
    BADGE_AUTH_HEADERS.session,
  );
  const ts = header(
    request.headers.get(BADGE_AUTH_HEADERS.timestamp) ?? undefined,
    BADGE_AUTH_HEADERS.timestamp,
  );
  const sig = header(
    request.headers.get(BADGE_AUTH_HEADERS.signature) ?? undefined,
    BADGE_AUTH_HEADERS.signature,
  );
  if (!isAddress(session)) throw new SecurityError("auth_malformed", 401, "session key is not an address");
  if (!TIMESTAMP_PATTERN.test(ts)) throw new SecurityError("auth_malformed", 401, "timestamp is not unix ms");
  if (!SIGNATURE_PATTERN.test(sig))
    throw new SecurityError("auth_malformed", 401, "signature is not 65 bytes");

  const timestamp = Number(ts);
  const now = clock.now();
  if (Math.abs(now - timestamp) > MAX_REQUEST_SKEW_MS) {
    throw new SecurityError(
      "clock_skew",
      401,
      `request timestamp is ${Math.round((timestamp - now) / 1000)} s away from the enclave clock (max ${MAX_REQUEST_SKEW_MS / 1000} s)`,
    );
  }
  const sessionKey = getAddress(session);
  const signed = canonicalRequest({ method: request.method, pathWithQuery, timestamp, body });
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message: signed, signature: sig as Hex });
  } catch (error) {
    throw new SecurityError("bad_signature", 401, "signature cannot be recovered", { cause: error });
  }
  if (!isAddressEqual(signer, sessionKey)) {
    throw new SecurityError("bad_signature", 401, "request is not signed by the session key it names");
  }
  // Keyed on what was signed, not on the signature bytes: ECDSA signatures are malleable (s -> n - s), so a
  // signature-keyed cache would let an attacker replay a request under a twin signature.
  const replayKey = sha256(stringToBytes(`${sessionKey}\n${signed}`));
  // Once the timestamp leaves the window the skew check refuses it, so the entry can be forgotten then.
  const verdict = replays.checkAndRemember(replayKey, timestamp + MAX_REQUEST_SKEW_MS, now);
  if (verdict === "replay") throw new SecurityError("replay", 401, "request already processed (replay)");
  if (verdict === "full")
    throw new SecurityError("replay_cache_full", 503, "too many requests, retry shortly");

  const caller = await resolver.resolve(sessionKey);
  if (!caller) throw new SecurityError("session_unknown", 401, "session is unknown, expired or revoked");
  if (!isAddressEqual(caller.sessionKey, sessionKey)) {
    // A resolver bug must not let one session act as another.
    throw new SecurityError("session_unknown", 401, "session resolver returned another session");
  }
  return caller;
}

/**
 * Hono middleware authenticating every non-public request and exposing the caller as `c.var.caller`.
 * Mount it on `/v1/*` before the domain routes (`mountSecurityRoutes` does): new routes are protected by default.
 * Refusals: 401 (`auth_missing`, `auth_malformed`, `clock_skew`, `bad_signature`, `replay`, `session_unknown`),
 * 413 (`body_too_large`), 503 (`replay_cache_full`).
 */
export function createAuthMiddleware(
  resolver: SessionResolver,
  clock: Clock,
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<BadgeEnv> {
  const replays = new ReplayCache(options.replayCacheCapacity ?? DEFAULT_REPLAY_CACHE_CAPACITY);
  return createMiddleware<BadgeEnv>(async (c, next) => {
    if (isPublicRoute(c.req.method, c.req.path)) return next();
    let caller: Caller;
    try {
      const declaredLength = Number(c.req.header("content-length") ?? "0");
      if (declaredLength > MAX_AUTHENTICATED_BODY_BYTES) {
        throw new SecurityError("body_too_large", 413, `body exceeds ${MAX_AUTHENTICATED_BODY_BYTES} bytes`);
      }
      // Hono caches the body, so handlers can still call c.req.json() after this read.
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (body.length > MAX_AUTHENTICATED_BODY_BYTES) {
        throw new SecurityError("body_too_large", 413, `body exceeds ${MAX_AUTHENTICATED_BODY_BYTES} bytes`);
      }
      const url = new URL(c.req.url);
      caller = await authenticate(c.req.raw, url.pathname + url.search, body, clock, replays, resolver);
    } catch (error) {
      if (error instanceof SecurityError) return securityErrorResponse(c, error);
      throw error;
    }
    c.set("caller", caller);
    return next();
  });
}
