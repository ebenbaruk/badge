import { describe, expect, it } from "vitest";
import { isLoopbackUrl, parseServerConfig } from "./config";

const OS = { mrtd: "11".repeat(48), rtmr0: "22".repeat(48), rtmr1: "33".repeat(48), rtmr2: "44".repeat(48) };
const PINS = JSON.stringify({ composeHash: "ab".repeat(32), appId: "cd".repeat(20), osMeasurements: OS });
const readPins = () => PINS;
const REMOTE = "https://23aacbff-8787.dstack-prod5.phala.network";

describe("server configuration", () => {
  it("recognises loopback enclaves only", () => {
    expect(isLoopbackUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:8787")).toBe(true);
    expect(isLoopbackUrl(REMOTE)).toBe(false);
    expect(isLoopbackUrl("http://127.0.0.1.example.com")).toBe(false);
  });

  it("defaults to simulated attestation for a local enclave", () => {
    expect(parseServerConfig({}, readPins).live).toMatchObject({ attestationMode: "simulated", pins: {} });
  });

  it("defaults to tdx for a remote enclave, and then requires every pin", () => {
    expect(() => parseServerConfig({ BADGE_ENCLAVE_URL: REMOTE }, readPins)).toThrow(
      /BADGE_ENCLAVE_COMPOSE_HASH/,
    );
    const config = parseServerConfig(
      { BADGE_ENCLAVE_URL: REMOTE, BADGE_ENCLAVE_OS_MEASUREMENTS_FILE: "pins.json" },
      readPins,
    );
    expect(config.live).toMatchObject({
      attestationMode: "tdx",
      pins: {
        expectedComposeHash: "ab".repeat(32),
        expectedAppId: "cd".repeat(20),
        expectedOsMeasurements: OS,
      },
    });
  });

  it("refuses simulated attestation for a remote enclave", () => {
    expect(() =>
      parseServerConfig({ BADGE_ENCLAVE_URL: REMOTE, BADGE_ATTESTATION_MODE: "simulated" }, readPins),
    ).toThrow(/only allowed for a loopback enclave/);
  });
});
