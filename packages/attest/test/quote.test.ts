import { describe, expect, it } from "vitest";
import { QuoteFormatError } from "../src/errors";
import { parseTdxQuote } from "../src/quote";
import { flipByte, simulatorFixture } from "./helpers";

describe("parseTdxQuote", () => {
  it("extracts the measurements of the simulator quote", () => {
    const quote = parseTdxQuote(simulatorFixture.quote);
    expect(quote.version).toBe(4);
    expect(quote.teeType).toBe(0x81);
    expect(quote.reportData).toBe(simulatorFixture.reportData);
    expect(quote.rtmrs).toEqual(simulatorFixture.sdkReplayedRtmrs);
    expect(quote.mrtd).toMatch(/^[0-9a-f]{96}$/);
    expect(quote.debug).toBe(false);
  });

  it("accepts a 0x prefix and raw bytes", () => {
    const fromHex = parseTdxQuote(`0x${simulatorFixture.quote}`);
    const fromBytes = parseTdxQuote(fromHex.bytes);
    expect(fromBytes.rtmrs).toEqual(fromHex.rtmrs);
  });

  it("detects the TD debug attribute", () => {
    const debugQuote = flipByte(simulatorFixture.quote, 48 + 120);
    expect(parseTdxQuote(debugQuote).debug).toBe(true);
  });

  it("rejects non-hex input", () => {
    expect(() => parseTdxQuote("not a quote")).toThrow(QuoteFormatError);
  });

  it("rejects a truncated quote", () => {
    expect(() => parseTdxQuote(simulatorFixture.quote.slice(0, 600))).toThrow(/at least/);
  });

  it("rejects a quote whose signature data is truncated", () => {
    const withoutSignature = simulatorFixture.quote.slice(0, (48 + 584 + 4 + 10) * 2);
    expect(() => parseTdxQuote(withoutSignature)).toThrow(/signature data/);
  });

  it("rejects another quote version or TEE type", () => {
    const sgx = simulatorFixture.quote.slice(0, 8) + "00000000" + simulatorFixture.quote.slice(16);
    expect(() => parseTdxQuote(sgx)).toThrow(expect.objectContaining({ code: "UNSUPPORTED_QUOTE" }));
    const v3 = "0300" + simulatorFixture.quote.slice(4);
    expect(() => parseTdxQuote(v3)).toThrow(expect.objectContaining({ code: "UNSUPPORTED_QUOTE" }));
  });
});
