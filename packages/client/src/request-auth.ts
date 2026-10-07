/**
 * Request authentication format shared by the SDK (signer) and the enclave (verifier). It lives here, in the SDK,
 * because the SDK is the reference implementation of the HTTP contract; the enclave imports it so both ends can
 * never drift apart.
 *
 * Every authenticated call carries three headers:
 * - `x-badge-session`: the agent session key address (registered by a Ledger-signed AgentSession);
 * - `x-badge-ts`: unix time in milliseconds;
 * - `x-badge-sig`: EIP-191 `personal_sign` by the session key of {@link canonicalRequest}.
 */
import { sha256, stringToBytes } from "viem";

/** Header names (lowercase: HTTP headers are case-insensitive and fetch normalises them to lowercase). */
export const BADGE_AUTH_HEADERS = {
  session: "x-badge-session",
  timestamp: "x-badge-ts",
  signature: "x-badge-sig",
} as const;

/** Version tag of the signed string: a future format change cannot be confused with this one. */
export const REQUEST_SIGNING_PREFIX = "BADGE-REQ-V1";

/**
 * Maximum distance between the request timestamp and the enclave clock. Short, because the replay cache only has
 * to remember signatures for this long; a client with a badly set clock is told so by the `CLOCK_SKEW` error.
 */
export const MAX_REQUEST_SKEW_MS = 60_000;

/** What is signed: method, path with query, timestamp and body digest. */
export interface RequestToSign {
  method: string;
  /** Path and query string exactly as sent, e.g. `/v1/tasks?limit=5`. */
  pathWithQuery: string;
  /** Unix milliseconds. */
  timestamp: number;
  /** Raw body bytes (empty for GET). */
  body: Uint8Array;
}

/** Lowercase hex sha256 of the body, without `0x` (sha256 of the empty string for a body-less request). */
export function bodyDigest(body: Uint8Array): string {
  return sha256(body).slice(2);
}

/**
 * The exact string signed with EIP-191: `BADGE-REQ-V1\n{METHOD}\n{path+query}\n{ts}\n{sha256(body) hex}`.
 * The method is upper-cased so that `post` and `POST` sign the same thing, as HTTP treats them.
 */
export function canonicalRequest(request: RequestToSign): string {
  return [
    REQUEST_SIGNING_PREFIX,
    request.method.toUpperCase(),
    request.pathWithQuery,
    String(request.timestamp),
    bodyDigest(request.body),
  ].join("\n");
}

/** UTF-8 bytes of a request body given as a string (or none). */
export function bodyBytes(body: string | null | undefined): Uint8Array {
  return body === null || body === undefined ? new Uint8Array() : stringToBytes(body);
}
