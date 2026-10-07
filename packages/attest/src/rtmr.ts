import { sha384 } from "@noble/hashes/sha2";
import { z } from "zod";
import { concatBytes, decodeHex, normalizeHex, toHex, utf8ToBytes } from "./bytes";
import { EventLogError } from "./errors";

const RTMR_LENGTH = 48;
const RTMR_COUNT = 4;
/** RTMR3 is the only register dstack extends at runtime with application events (app id, compose hash...). */
export const RUNTIME_RTMR_INDEX = 3;
/** Event type dstack uses for its runtime events (DSTACK_RUNTIME_EVENT_TYPE). */
export const DSTACK_RUNTIME_EVENT_TYPE = 0x08000001;
const EVENT_SEPARATOR = utf8ToBytes(":");

/** Names of the RTMR3 events Badge relies on. */
export const DSTACK_EVENTS = {
  appId: "app-id",
  composeHash: "compose-hash",
  instanceId: "instance-id",
  keyProvider: "key-provider",
} as const;

const APP_ID_LENGTH = 20;
const COMPOSE_HASH_LENGTH = 32;

const hexString = z.string().regex(/^(0x)?([0-9a-fA-F]{2})*$/, "must be hex");

const eventSchema = z.object({
  imr: z
    .number()
    .int()
    .min(0)
    .max(RTMR_COUNT - 1),
  event_type: z.number().int().nonnegative(),
  digest: hexString,
  event: z.string(),
  event_payload: hexString,
});

/** One entry of the dstack event log (the JSON array returned by `getQuote`). */
export type DstackEvent = z.infer<typeof eventSchema>;

/**
 * Parses the dstack event log, given as the JSON string returned by `getQuote` or as an already-parsed array.
 * @throws EventLogError when it is not valid JSON or an entry is malformed.
 */
export function parseEventLog(eventLog: string | unknown[]): DstackEvent[] {
  let raw: unknown = eventLog;
  if (typeof eventLog === "string") {
    try {
      raw = JSON.parse(eventLog);
    } catch (error) {
      throw new EventLogError("MALFORMED_EVENT_LOG", "event log is not valid JSON", { cause: error });
    }
  }
  const parsed = z.array(eventSchema).safeParse(raw);
  if (!parsed.success) {
    throw new EventLogError(
      "MALFORMED_EVENT_LOG",
      `event log is malformed: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

/**
 * Digest dstack extends into RTMR3 for a runtime event: sha384(u32le(type) || ":" || event || ":" || payload).
 * Recomputing it is what binds an event's *payload* (e.g. the compose hash) to the quote.
 */
export function runtimeEventDigest(eventType: number, event: string, payloadHex: string): string {
  const type = new Uint8Array(4);
  new DataView(type.buffer).setUint32(0, eventType, true);
  const payload = decodeHex(payloadHex, `payload of event "${event}"`);
  return toHex(sha384(concatBytes(type, EVENT_SEPARATOR, utf8ToBytes(event), EVENT_SEPARATOR, payload)));
}

/** Replays a list of extend digests: RTMR = sha384(RTMR || digest), starting from 48 zero bytes. */
function replayDigests(digests: readonly string[]): string {
  let register: Uint8Array = new Uint8Array(RTMR_LENGTH);
  for (const digest of digests) {
    let bytes = decodeHex(digest, "event digest");
    if (bytes.length > RTMR_LENGTH) {
      throw new EventLogError(
        "MALFORMED_EVENT_LOG",
        `event digest is ${bytes.length} bytes, max ${RTMR_LENGTH}`,
      );
    }
    // TDX extends always take 48 bytes; shorter digests are right-padded with zeros, like the guest agent does.
    if (bytes.length < RTMR_LENGTH) bytes = concatBytes(bytes, new Uint8Array(RTMR_LENGTH - bytes.length));
    register = sha384(concatBytes(register, bytes));
  }
  return toHex(register);
}

/**
 * Replays RTMR0-3 from the event log. Before replaying, every RTMR3 event digest is recomputed from its name and
 * payload: an event whose digest does not match (or of an unknown type) is rejected, otherwise a forged
 * compose-hash payload could ride on a genuine digest.
 * @throws EventLogError on any digest mismatch or unknown RTMR3 event type.
 */
export function replayRtmrs(events: readonly DstackEvent[]): [string, string, string, string] {
  // A real dstack CVM (unlike the simulator) leaves the digest of RTMR3 runtime events empty in the event log it
  // returns with getQuote: the digest is defined by the payload, so we derive it. This loses nothing: the derived
  // digests are then replayed and must reproduce the quote's RTMR3, which is what authenticates the payloads.
  events = events.map((event) =>
    event.imr === RUNTIME_RTMR_INDEX &&
    event.event_type === DSTACK_RUNTIME_EVENT_TYPE &&
    normalizeHex(event.digest) === ""
      ? { ...event, digest: runtimeEventDigest(event.event_type, event.event, event.event_payload) }
      : event,
  );
  for (const event of events) {
    if (event.imr !== RUNTIME_RTMR_INDEX) continue;
    if (event.event_type !== DSTACK_RUNTIME_EVENT_TYPE) {
      throw new EventLogError(
        "EVENT_DIGEST_MISMATCH",
        `RTMR3 event "${event.event}" has type 0x${event.event_type.toString(16)}, its payload cannot be checked`,
      );
    }
    const expected = runtimeEventDigest(event.event_type, event.event, event.event_payload);
    if (expected !== normalizeHex(event.digest)) {
      throw new EventLogError(
        "EVENT_DIGEST_MISMATCH",
        `digest of RTMR3 event "${event.event}" does not match its payload`,
      );
    }
  }
  const byRegister = (index: number) => events.filter((e) => e.imr === index).map((e) => e.digest);
  return [
    replayDigests(byRegister(0)),
    replayDigests(byRegister(1)),
    replayDigests(byRegister(2)),
    replayDigests(byRegister(3)),
  ];
}

/**
 * Checks that the event log replays to the RTMRs of the quote (all four registers).
 * @throws EventLogError("RTMR_MISMATCH") naming the first register that differs.
 */
export function assertRtmrsMatch(replayed: readonly string[], quoted: readonly string[]): void {
  for (let index = 0; index < RTMR_COUNT; index++) {
    if (replayed[index] !== quoted[index]) {
      throw new EventLogError("RTMR_MISMATCH", `replayed RTMR${index} does not match the quote`);
    }
  }
}

/** Application identity attested in RTMR3. */
export interface AttestedAppIdentity {
  /** 20-byte dstack app id (hex): binds the KMS keys of the app. */
  appId: string;
  /** 32-byte compose hash (hex): sha256 of the exact app-compose document. */
  composeHash: string;
  /** Key provider name from the `key-provider` event (`kms` in production), when present. */
  keyProvider: string | undefined;
}

function singleRuntimeEvent(events: readonly DstackEvent[], name: string): DstackEvent | undefined {
  const matches = events.filter((e) => e.imr === RUNTIME_RTMR_INDEX && e.event === name);
  // Two events with the same name would make "the" attested value ambiguous: refuse rather than pick one.
  if (matches.length > 1) {
    throw new EventLogError("DUPLICATE_EVENT", `RTMR3 contains ${matches.length} "${name}" events`);
  }
  return matches[0];
}

const keyProviderSchema = z.object({ name: z.string() });

function parseKeyProvider(payloadHex: string): string {
  const text = new TextDecoder().decode(decodeHex(payloadHex, "key-provider payload"));
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new EventLogError("MALFORMED_EVENT_LOG", "key-provider event payload is not JSON", {
      cause: error,
    });
  }
  const parsed = keyProviderSchema.safeParse(json);
  if (!parsed.success) {
    throw new EventLogError("MALFORMED_EVENT_LOG", "key-provider event payload has no name");
  }
  return parsed.data.name;
}

/**
 * Extracts the app id, compose hash and key provider from the RTMR3 events. Call it only on an event log that
 * `replayRtmrs` + `assertRtmrsMatch` accepted, otherwise the values are not attested.
 * @throws EventLogError when an event is missing, duplicated or has a payload of the wrong size.
 */
export function extractAppIdentity(events: readonly DstackEvent[]): AttestedAppIdentity {
  const appIdEvent = singleRuntimeEvent(events, DSTACK_EVENTS.appId);
  const composeEvent = singleRuntimeEvent(events, DSTACK_EVENTS.composeHash);
  const keyProviderEvent = singleRuntimeEvent(events, DSTACK_EVENTS.keyProvider);
  if (!appIdEvent || !composeEvent) {
    throw new EventLogError(
      "MISSING_EVENT",
      "RTMR3 must contain exactly one app-id and one compose-hash event",
    );
  }
  const appId = decodeHex(appIdEvent.event_payload, "app-id payload");
  const composeHash = decodeHex(composeEvent.event_payload, "compose-hash payload");
  if (appId.length !== APP_ID_LENGTH || composeHash.length !== COMPOSE_HASH_LENGTH) {
    throw new EventLogError(
      "MALFORMED_EVENT_LOG",
      `app-id must be ${APP_ID_LENGTH} bytes and compose-hash ${COMPOSE_HASH_LENGTH} bytes`,
    );
  }
  return {
    appId: toHex(appId),
    composeHash: toHex(composeHash),
    keyProvider: keyProviderEvent ? parseKeyProvider(keyProviderEvent.event_payload) : undefined,
  };
}
