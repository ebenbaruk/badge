import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEventLog, replayRtmrs } from "../src";

// Event log captured from a real Phala Cloud CVM (Intel TDX). Unlike the simulator, dstack returns RTMR3 runtime
// events with an empty digest in the getQuote event log; the verifier must derive it from the payload.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/phala-prod-event-log.json", import.meta.url), "utf8"),
) as { tcb_info: { event_log: string | unknown[]; rtmr3: string } };

function withEmptyRuntimeDigests(log: string | unknown[]): unknown[] {
  const events = (typeof log === "string" ? JSON.parse(log) : log) as Array<Record<string, unknown>>;
  return events.map((e) => (e.imr === 3 ? { ...e, digest: "" } : e));
}

describe("RTMR replay on a real Phala CVM event log", () => {
  it("replays RTMR3 when runtime digests are given", () => {
    const rtmrs = replayRtmrs(parseEventLog(fixture.tcb_info.event_log));
    expect(rtmrs[3]).toBe(fixture.tcb_info.rtmr3.toLowerCase());
  });

  it("derives empty runtime digests from their payload and reaches the same RTMR3", () => {
    const rtmrs = replayRtmrs(parseEventLog(withEmptyRuntimeDigests(fixture.tcb_info.event_log)));
    expect(rtmrs[3]).toBe(fixture.tcb_info.rtmr3.toLowerCase());
  });

  it("still rejects a forged payload whose digest is given", () => {
    const events = parseEventLog(fixture.tcb_info.event_log).map((e) =>
      e.event === "compose-hash" ? { ...e, event_payload: "00".repeat(32) } : e,
    );
    expect(() => replayRtmrs(events)).toThrow(/does not match/);
  });
});
