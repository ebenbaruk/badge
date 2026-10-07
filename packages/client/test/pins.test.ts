import { describe, expect, it } from "vitest";
import { enclavePinsFromEnv } from "../src/pins";

const COMPOSE = "ab".repeat(32);
const APP_ID = "cd".repeat(20);
const OS = { mrtd: "11".repeat(48), rtmr0: "22".repeat(48), rtmr1: "33".repeat(48), rtmr2: "44".repeat(48) };
const FILE = "/pins/expected-measurements.json";
const pinsFile = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    capturedAt: "2026-10-07T00:00:00Z",
    composeHash: COMPOSE,
    appId: APP_ID,
    osMeasurements: OS,
    ...overrides,
  });
const reader = (content: string) => (path: string) => {
  if (path !== FILE) throw new Error(`unexpected read of ${path}`);
  return content;
};

describe("enclavePinsFromEnv", () => {
  it("reads every pin from the measurements file, KMS id included", () => {
    const pins = enclavePinsFromEnv(
      { BADGE_ENCLAVE_OS_MEASUREMENTS_FILE: FILE },
      "tdx",
      reader(pinsFile({ keyProviderId: "0xAB" })),
    );
    expect(pins).toEqual({
      expectedComposeHash: COMPOSE,
      expectedAppId: APP_ID,
      expectedOsMeasurements: OS,
      expectedKeyProviderId: "ab",
    });
  });

  it("fails closed in tdx mode without the app id or the OS measurements", () => {
    expect(() => enclavePinsFromEnv({ BADGE_ENCLAVE_COMPOSE_HASH: COMPOSE }, "tdx", reader(""))).toThrow(
      /BADGE_ENCLAVE_APP_ID, BADGE_ENCLAVE_OS_MEASUREMENTS_FILE/,
    );
    expect(() =>
      enclavePinsFromEnv(
        { BADGE_ENCLAVE_COMPOSE_HASH: COMPOSE, BADGE_ENCLAVE_APP_ID: APP_ID },
        "tdx",
        reader(""),
      ),
    ).toThrow(/BADGE_ENCLAVE_OS_MEASUREMENTS_FILE/);
  });

  it("refuses an environment that disagrees with the pins file", () => {
    const env = { BADGE_ENCLAVE_OS_MEASUREMENTS_FILE: FILE, BADGE_ENCLAVE_APP_ID: "ee".repeat(20) };
    expect(() => enclavePinsFromEnv(env, "tdx", reader(pinsFile()))).toThrow(/BADGE_ENCLAVE_APP_ID differs/);
  });

  it("refuses a malformed pins file", () => {
    const env = { BADGE_ENCLAVE_OS_MEASUREMENTS_FILE: FILE };
    expect(() => enclavePinsFromEnv(env, "tdx", reader("{}"))).toThrow(/cannot read pins/);
  });

  it("allows no pins in simulated mode, and keeps the ones given", () => {
    expect(enclavePinsFromEnv({}, "simulated", reader(""))).toEqual({});
    expect(
      enclavePinsFromEnv(
        { BADGE_ENCLAVE_COMPOSE_HASH: `0x${COMPOSE.toUpperCase()}` },
        "simulated",
        reader(""),
      ),
    ).toEqual({
      expectedComposeHash: COMPOSE,
    });
  });
});
