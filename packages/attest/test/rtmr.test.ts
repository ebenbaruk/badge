import { describe, expect, it } from "vitest";
import { EventLogError } from "../src/errors";
import { parseTdxQuote } from "../src/quote";
import {
  assertRtmrsMatch,
  extractAppIdentity,
  parseEventLog,
  replayRtmrs,
  runtimeEventDigest,
  type DstackEvent,
} from "../src/rtmr";
import { simulatorFixture } from "./helpers";

const events = () => parseEventLog(simulatorFixture.eventLog);
const quote = parseTdxQuote(simulatorFixture.quote);

function withEvent(name: string, change: (event: DstackEvent) => DstackEvent): DstackEvent[] {
  return events().map((e) => (e.imr === 3 && e.event === name ? change(e) : e));
}

describe("event log replay", () => {
  it("recomputes every RTMR3 runtime event digest", () => {
    for (const e of events().filter((event) => event.imr === 3)) {
      expect(runtimeEventDigest(e.event_type, e.event, e.event_payload)).toBe(e.digest);
    }
  });

  it("replays RTMR0-3 to the quote values (and to the SDK's replay)", () => {
    const replayed = replayRtmrs(events());
    expect(replayed).toEqual(simulatorFixture.sdkReplayedRtmrs);
    expect(() => assertRtmrsMatch(replayed, quote.rtmrs)).not.toThrow();
  });

  it("rejects a payload that does not match its digest", () => {
    const forged = withEvent("compose-hash", (e) => ({ ...e, event_payload: "00".repeat(32) }));
    expect(() => replayRtmrs(forged)).toThrow(expect.objectContaining({ code: "EVENT_DIGEST_MISMATCH" }));
  });

  it("rejects a forged event whose digest was recomputed: RTMR3 no longer matches", () => {
    const payload = "11".repeat(32);
    const forged = withEvent("compose-hash", (e) => ({
      ...e,
      event_payload: payload,
      digest: runtimeEventDigest(e.event_type, e.event, payload),
    }));
    expect(() => assertRtmrsMatch(replayRtmrs(forged), quote.rtmrs)).toThrow(
      expect.objectContaining({ code: "RTMR_MISMATCH", message: expect.stringContaining("RTMR3") }),
    );
  });

  it("rejects an RTMR3 event of an unknown type", () => {
    const forged = withEvent("app-id", (e) => ({ ...e, event_type: 1 }));
    expect(() => replayRtmrs(forged)).toThrow(EventLogError);
  });

  it("rejects malformed logs", () => {
    expect(() => parseEventLog("{not json")).toThrow(
      expect.objectContaining({ code: "MALFORMED_EVENT_LOG" }),
    );
    expect(() =>
      parseEventLog([{ imr: 7, event_type: 1, digest: "", event: "", event_payload: "" }]),
    ).toThrow(EventLogError);
  });
});

describe("extractAppIdentity", () => {
  it("returns the app id, compose hash and key provider", () => {
    expect(extractAppIdentity(events())).toEqual({
      appId: simulatorFixture.appId,
      composeHash: simulatorFixture.composeHash,
      keyProvider: "kms",
      keyProviderId: expect.stringMatching(/^3059[0-9a-f]+$/),
    });
  });

  it("rejects a duplicated compose-hash event", () => {
    const all = events();
    const compose = all.find((e) => e.event === "compose-hash");
    if (!compose) throw new Error("fixture has no compose-hash event");
    expect(() => extractAppIdentity([...all, compose])).toThrow(
      expect.objectContaining({ code: "DUPLICATE_EVENT" }),
    );
  });

  it("rejects a log without compose-hash", () => {
    const withoutCompose = events().filter((e) => e.event !== "compose-hash");
    expect(() => extractAppIdentity(withoutCompose)).toThrow(
      expect.objectContaining({ code: "MISSING_EVENT" }),
    );
  });
});
