/**
 * How a request reaches the enclave: straight over HTTP (`plain`, local development) or sealed inside the attested
 * channel (`channel`, production: on Phala, TLS terminates at the gateway, so only the channel reaches the enclave).
 */
import {
  ClientChannel,
  verifyAttestation,
  type AttestationMode,
  type AttestationResult,
  type VerifiedAttestation,
} from "@badge/attest";
import type { z } from "zod";
import {
  CHANNEL_PATHS,
  channelMessageResponseSchema,
  channelOpenResponseSchema,
  innerResponseSchema,
  type InnerRequest,
  type InnerResponse,
} from "./channel-wire";
import { apiErrorBodySchema, BadgeApiError } from "./errors";

/** The fetch signature the SDK needs (lets tests and in-process callers pass their own). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Sends one API request and returns the raw response. */
export interface Transport {
  send(request: InnerRequest): Promise<InnerResponse>;
}

/** Enclave error code meaning the channel id is unknown or expired: the request was NOT processed. */
export const CHANNEL_UNKNOWN_CODE = "CHANNEL_UNKNOWN";

async function httpCall(fetchFn: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    throw new BadgeApiError(0, "NETWORK_ERROR", `cannot reach the enclave at ${url}`, { cause: error });
  }
}

/** Turns a non-2xx response body into a {@link BadgeApiError}, keeping the enclave's code when there is one. */
export function errorFromResponse(status: number, body: string): BadgeApiError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new BadgeApiError(status, "BAD_RESPONSE", `HTTP ${status} with a non-JSON body`);
  }
  const checked = apiErrorBodySchema.safeParse(parsed);
  if (!checked.success) return new BadgeApiError(status, "BAD_RESPONSE", `HTTP ${status} without error body`);
  return new BadgeApiError(status, checked.data.error.code, checked.data.error.message);
}

/** Reads and validates a JSON body (outer channel routes). */
async function readJson<T>(response: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw errorFromResponse(response.status, text);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new BadgeApiError(response.status, "BAD_RESPONSE", `${what}: response is not JSON`, {
      cause: error,
    });
  }
  const checked = schema.safeParse(value);
  if (!checked.success) {
    throw new BadgeApiError(response.status, "BAD_RESPONSE", `${what}: unexpected response shape`, {
      cause: checked.error,
    });
  }
  return checked.data;
}

/** Direct HTTP: for local development only (the enclave may refuse it with `CHANNEL_REQUIRED`). */
export class PlainTransport implements Transport {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchLike,
  ) {}

  async send(request: InnerRequest): Promise<InnerResponse> {
    const response = await httpCall(this.fetchFn, `${this.baseUrl}${request.path}`, {
      method: request.method,
      headers: request.headers,
      ...(request.body === null ? {} : { body: request.body }),
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
  }
}

export interface ChannelTransportOptions {
  baseUrl: string;
  fetchFn: FetchLike;
  attestationMode: AttestationMode;
  /** Pinned compose hash (hex). Mandatory in `tdx` mode, checked when given in `simulated` mode. */
  expectedComposeHash?: string;
  /** Called with every attestation result, including failures (for the UI badge). */
  onAttestation?: (result: AttestationResult) => void;
}

/**
 * Attested channel: opens it lazily, verifies the enclave quote before deriving any key, then seals each request.
 * Requests are serialised because channel messages carry strict sequence numbers in both directions.
 */
export class ChannelTransport implements Transport {
  private channel: { client: ClientChannel; id: string } | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private lastAttestation: AttestationResult | undefined;

  constructor(private readonly options: ChannelTransportOptions) {}

  /** Result of the latest attestation check, or undefined before the first one. */
  get attestation(): AttestationResult | undefined {
    return this.lastAttestation;
  }

  /** Opens (or reuses) the channel; throws `ATTESTATION_FAILED` if the enclave cannot be verified. */
  async connect(): Promise<VerifiedAttestation> {
    await this.ensureChannel();
    // ensureChannel only returns with a verified attestation.
    return this.lastAttestation as VerifiedAttestation;
  }

  send(request: InnerRequest): Promise<InnerResponse> {
    const result = this.queue.then(() => this.sendNow(request));
    // Keep the queue alive after a failure: the next request must still run (on a fresh channel if needed).
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async sendNow(request: InnerRequest): Promise<InnerResponse> {
    try {
      return await this.exchange(request);
    } catch (error) {
      // The channel is in an unknown state after any failure (sequence numbers may be out of step): drop it.
      this.channel = undefined;
      // Only an unknown/expired channel guarantees the request was not executed, so only then is a retry safe.
      if (error instanceof BadgeApiError && error.code === CHANNEL_UNKNOWN_CODE) {
        return this.exchange(request);
      }
      throw error;
    }
  }

  private async exchange(request: InnerRequest): Promise<InnerResponse> {
    const channel = await this.ensureChannel();
    const sealed = channel.client.seal(request);
    const response = await httpCall(
      this.options.fetchFn,
      `${this.options.baseUrl}${CHANNEL_PATHS.message(channel.id)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sealed }),
      },
    );
    const outer = await readJson(response, channelMessageResponseSchema, "channel message");
    try {
      return channel.client.open(outer.sealed, innerResponseSchema);
    } catch (error) {
      throw new BadgeApiError(0, "CHANNEL_FAILED", "cannot open the enclave's sealed response", {
        cause: error,
      });
    }
  }

  private async ensureChannel(): Promise<{ client: ClientChannel; id: string }> {
    if (this.channel) return this.channel;
    const client = ClientChannel.create();
    const response = await httpCall(this.options.fetchFn, `${this.options.baseUrl}${CHANNEL_PATHS.open}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(client.hello),
    });
    const opened = await readJson(response, channelOpenResponseSchema, "channel open");
    // nonce and clientPk come from our own state, never from the response (verifyAttestation contract).
    const result = await verifyAttestation({
      ...opened.bundle,
      ...client.hello,
      mode: this.options.attestationMode,
      ...(this.options.expectedComposeHash === undefined
        ? {}
        : { expectedComposeHash: this.options.expectedComposeHash }),
    });
    this.lastAttestation = result;
    this.options.onAttestation?.(result);
    if (!result.ok) {
      throw new BadgeApiError(
        0,
        "ATTESTATION_FAILED",
        `enclave attestation rejected (${result.code}): ${result.reason}`,
      );
    }
    try {
      client.establish(result);
    } catch (error) {
      throw new BadgeApiError(0, "CHANNEL_FAILED", "cannot establish the channel", { cause: error });
    }
    if (client.channelId !== opened.channelId || result.enclavePk !== opened.enclavePk) {
      throw new BadgeApiError(
        0,
        "CHANNEL_FAILED",
        "the enclave announced another channel than the attested one",
      );
    }
    this.channel = { client, id: opened.channelId };
    return this.channel;
  }
}
