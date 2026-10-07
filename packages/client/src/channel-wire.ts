/**
 * Wire format of the attested channel routes, shared by the SDK and the enclave:
 * - `POST /v1/channel/open` {@link ChannelOpenRequest} -> {@link ChannelOpenResponse};
 * - `POST /v1/channel/:id` {@link ChannelMessageRequest} -> {@link ChannelMessageResponse}, whose sealed payloads
 *   are an {@link InnerRequest} (client -> enclave) and an {@link InnerResponse} (enclave -> client).
 */
import { attestationBundleSchema, channelHelloSchema, sealedMessageSchema } from "@badge/attest";
import { z } from "zod";

export const CHANNEL_PATHS = {
  open: "/v1/channel/open",
  message: (channelId: string) => `/v1/channel/${channelId}`,
  prefix: "/v1/channel/",
} as const;

/** Methods an inner request may use: the API only has these. */
export const INNER_METHODS = ["GET", "POST", "DELETE"] as const;

/**
 * Headers forwarded from an inner request to the API. An allowlist, so a client cannot smuggle hop-by-hop or
 * proxy headers (e.g. `x-forwarded-for`) into the enclave's own routing.
 */
export const INNER_REQUEST_HEADERS = [
  "content-type",
  "x-badge-session",
  "x-badge-ts",
  "x-badge-sig",
] as const;

/** Bounds a single request or response body; nothing in the API comes close (briefs are a few KB). */
export const MAX_CHANNEL_BODY_LENGTH = 1_000_000;

export const channelOpenRequestSchema = channelHelloSchema;
export type ChannelOpenRequest = z.infer<typeof channelOpenRequestSchema>;

export const channelOpenResponseSchema = z.object({
  channelId: z.string().regex(/^[0-9a-f]{64}$/),
  enclavePk: z.string().regex(/^[0-9a-f]{64}$/),
  bundle: attestationBundleSchema,
});
export type ChannelOpenResponse = z.infer<typeof channelOpenResponseSchema>;

export const channelMessageRequestSchema = z.object({ sealed: sealedMessageSchema });
export type ChannelMessageRequest = z.infer<typeof channelMessageRequestSchema>;

export const channelMessageResponseSchema = channelMessageRequestSchema;
export type ChannelMessageResponse = ChannelMessageRequest;

export const innerRequestSchema = z.strictObject({
  method: z.enum(INNER_METHODS),
  /** Only API routes; the channel routes themselves cannot be reached through the channel (no nesting). */
  path: z
    .string()
    .max(2048)
    .regex(/^\/v1\/[A-Za-z0-9/_.~%?=&:-]*$/, "path must be an API path under /v1/")
    // URL parsing resolves dot segments, which would let "/v1/../x" escape the /v1 prefix checked here.
    .refine((path) => !path.includes(".."), "dot segments are not allowed")
    .refine((path) => !path.startsWith(CHANNEL_PATHS.prefix), "the channel cannot be nested"),
  headers: z.partialRecord(z.enum(INNER_REQUEST_HEADERS), z.string().max(512)),
  body: z.string().max(MAX_CHANNEL_BODY_LENGTH).nullable(),
});
export type InnerRequest = z.infer<typeof innerRequestSchema>;

export const innerResponseSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  contentType: z.string().max(256).nullable(),
  body: z.string().max(MAX_CHANNEL_BODY_LENGTH),
});
export type InnerResponse = z.infer<typeof innerResponseSchema>;
