import { describe, expect, it } from "vitest";
import {
  composeHashOf,
  composePolicyViolations,
  enclaveMeasurementFrom,
  parseAppCompose,
} from "../src/compose";
import { ComposeError } from "../src/errors";
import { COMPLIANT_COMPOSE, simulatorFixture } from "./helpers";

describe("composeHashOf", () => {
  it("is the sha256 of the exact string", () => {
    expect(composeHashOf("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("changes when the same JSON is serialized differently", () => {
    const reformatted = JSON.stringify(JSON.parse(COMPLIANT_COMPOSE), null, 2);
    expect(composeHashOf(reformatted)).not.toBe(composeHashOf(COMPLIANT_COMPOSE));
  });
});

describe("enclaveMeasurementFrom", () => {
  it("returns the compose hash as a lowercase bytes32", () => {
    const hash = "AB".repeat(32);
    expect(enclaveMeasurementFrom(hash)).toBe(`0x${"ab".repeat(32)}`);
    expect(enclaveMeasurementFrom(`0x${hash}`)).toBe(`0x${"ab".repeat(32)}`);
  });

  it("rejects anything that is not 32 bytes", () => {
    expect(() => enclaveMeasurementFrom("ab".repeat(20))).toThrow(ComposeError);
    expect(() => enclaveMeasurementFrom("zz".repeat(32))).toThrow(ComposeError);
  });
});

describe("compose policy", () => {
  it("accepts a compliant compose", () => {
    expect(composePolicyViolations(parseAppCompose(COMPLIANT_COMPOSE))).toEqual([]);
  });

  it("flags the simulator compose (public logs and sysinfo on)", () => {
    expect(composePolicyViolations(parseAppCompose(simulatorFixture.appCompose))).toEqual([
      "public_logs must be false",
      "public_sysinfo must be false",
    ]);
  });

  it("treats missing flags as violations (Phala defaults them to true)", () => {
    expect(composePolicyViolations(parseAppCompose("{}"))).toEqual([
      "public_logs must be false",
      "public_sysinfo must be false",
      "kms_enabled must be true",
    ]);
  });

  it("flags a local key provider", () => {
    const local = JSON.stringify({ ...JSON.parse(COMPLIANT_COMPOSE), local_key_provider_enabled: true });
    expect(composePolicyViolations(parseAppCompose(local))).toEqual([
      "local_key_provider_enabled must be false",
    ]);
  });

  it("flags a deployer-supplied endpoint: its value is not attested", () => {
    const compose = JSON.stringify({
      ...JSON.parse(COMPLIANT_COMPOSE),
      allowed_envs: ["PHALA_AI_API_KEY", "PHALA_AI_MODEL", "PHALA_AI_BASE_URL"],
    });
    expect(composePolicyViolations(parseAppCompose(compose))).toEqual([
      "allowed_envs must not configure an endpoint (PHALA_AI_BASE_URL)",
    ]);
  });

  it("rejects malformed documents", () => {
    expect(() => parseAppCompose("not json")).toThrow(ComposeError);
    expect(() => parseAppCompose('{"public_logs":"no"}')).toThrow(ComposeError);
  });
});
