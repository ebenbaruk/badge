import { describe, expect, it } from "vitest";
import { AttestError } from "../src/errors";
import {
  createAttestationBundle,
  deriveChannelKeyPair,
  deriveEnclaveKey,
  ENCLAVE_KEY_PATHS,
  type DstackAgent,
} from "../src/server";
import { verifyAttestation } from "../src/verify";
import { simulatorFixture } from "./helpers";

/** Replays the captured simulator answers; getKey returns a key derived from the path length. */
function stubAgent(overrides: Partial<DstackAgent> = {}): DstackAgent {
  return {
    getQuote: async () => ({ quote: `0x${simulatorFixture.quote}`, event_log: simulatorFixture.eventLog }),
    info: async () => ({
      app_id: simulatorFixture.appId,
      compose_hash: simulatorFixture.composeHash,
      tcb_info: { app_compose: simulatorFixture.appCompose },
    }),
    getKey: async (path) => ({ key: new Uint8Array(32).fill(path.length) }),
    ...overrides,
  };
}

const handshake = {
  nonce: simulatorFixture.nonce,
  clientPk: simulatorFixture.clientPk,
  enclavePk: simulatorFixture.enclavePk,
};

describe("createAttestationBundle", () => {
  it("returns a bundle that verifies in simulated mode", async () => {
    const bundle = await createAttestationBundle(stubAgent(), handshake);
    expect(bundle.quote).toBe(simulatorFixture.quote);
    expect(bundle.appCompose).toBe(simulatorFixture.appCompose);
    const result = await verifyAttestation({ ...bundle, ...handshake, mode: "simulated" });
    expect(result.ok).toBe(true);
  });

  it("refuses a quote over another report_data", async () => {
    await expect(
      createAttestationBundle(stubAgent(), { ...handshake, nonce: "02".repeat(32) }),
    ).rejects.toThrow(/another report_data/);
  });

  it("wraps guest agent failures", async () => {
    const failing = stubAgent({
      getQuote: async () => {
        throw new Error("Service not found: GetQuote");
      },
    });
    await expect(createAttestationBundle(failing, handshake)).rejects.toMatchObject({
      code: "DSTACK_FAILED",
      message: expect.stringContaining("Service not found"),
    });
  });

  it("validates the handshake", async () => {
    await expect(createAttestationBundle(stubAgent(), { ...handshake, clientPk: "00" })).rejects.toThrow(
      AttestError,
    );
  });
});

describe("deriveEnclaveKey", () => {
  it("derives keys from fixed paths", async () => {
    const key = await deriveEnclaveKey(stubAgent(), ENCLAVE_KEY_PATHS.employeeDek("bob"));
    expect(key).toHaveLength(32);
    const channel = await deriveChannelKeyPair(stubAgent());
    expect(channel.publicKey).toHaveLength(32);
  });

  it("rejects malformed paths", async () => {
    await expect(deriveEnclaveKey(stubAgent(), "../etc")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(deriveEnclaveKey(stubAgent(), "")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a key of the wrong size", async () => {
    const short = stubAgent({ getKey: async () => ({ key: new Uint8Array(16) }) });
    await expect(deriveEnclaveKey(short, "badge/x")).rejects.toMatchObject({ code: "DSTACK_FAILED" });
  });
});
