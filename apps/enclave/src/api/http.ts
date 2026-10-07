/** Small request helpers shared by the routes: JSON bodies and path parameters validated with zod. */
import type { Context } from "hono";
import type { Hex } from "viem";
import { z } from "zod";
import { EnclaveError } from "../errors";
import type { BadgeEnv } from "../security/types";

const BYTES32_ID = /^0x[0-9a-fA-F]{64}$/;

/**
 * The request body parsed as JSON (no schema: signed messages are decoded by @badge/consent).
 * @throws {EnclaveError} INVALID_REQUEST when the body is not JSON.
 */
export async function jsonBody(c: Context<BadgeEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (error) {
    throw new EnclaveError("INVALID_REQUEST", "the request body must be JSON", { cause: error });
  }
}

/** The request body validated by `schema`. @throws {EnclaveError} INVALID_REQUEST */
export async function parseBody<T>(c: Context<BadgeEnv>, schema: z.ZodType<T>): Promise<T> {
  const result = schema.safeParse(await jsonBody(c));
  if (!result.success) throw new EnclaveError("INVALID_REQUEST", z.prettifyError(result.error));
  return result.data;
}

/** A bytes32 id from the path, lower-cased. @throws {EnclaveError} INVALID_REQUEST */
export function idParam(c: Context<BadgeEnv>, name: string): Hex {
  const value = c.req.param(name);
  if (value === undefined || !BYTES32_ID.test(value)) {
    throw new EnclaveError("INVALID_REQUEST", `${name} must be a 0x-prefixed 32-byte hex id`);
  }
  return value.toLowerCase() as Hex;
}

/** Unix milliseconds as an ISO date for the JSON responses. */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}
