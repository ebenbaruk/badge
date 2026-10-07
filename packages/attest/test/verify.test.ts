import { describe, expect, it } from "vitest";
import { ClientChannel, EnclaveChannel, generateX25519KeyPair } from "../src/channel";
import { parseTdxQuote } from "../src/quote";
import {
  verifyAttestation,
  type AttestationResult,
  type DcapVerifier,
  type VerifiedAttestation,
  type VerifyAttestationInput,
} from "../src/verify";
import { flipByte, simulatorFixture, syntheticTdxBundle } from "./helpers";

const simulatedInput: VerifyAttestationInput = {
  quote: simulatorFixture.quote,
  eventLog: simulatorFixture.eventLog,
  appCompose: simulatorFixture.appCompose,
  nonce: simulatorFixture.nonce,
  clientPk: simulatorFixture.clientPk,
  enclavePk: simulatorFixture.enclavePk,
  mode: "simulated",
};

/** DCAP stub that accepts any quote with the given status, echoing the quote's own fields. */
const dcapWithStatus =
  (status: string): DcapVerifier =>
  async (bytes) => {
    const quote = parseTdxQuote(bytes);
    return { status, advisoryIds: [], rtmr3: quote.rtmrs[3], reportData: quote.reportData };
  };

function expectOk(result: AttestationResult): VerifiedAttestation {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.reason}`);
  return result;
}

describe("verifyAttestation, simulated mode", () => {
  it("accepts the simulator bundle and flags it as simulated", async () => {
    const result = expectOk(await verifyAttestation(simulatedInput));
    expect(result.simulated).toBe(true);
    expect(result.tcbStatus).toBe("Simulated");
    expect(result.composeHash).toBe(simulatorFixture.composeHash);
    expect(result.enclaveMeasurement).toBe(`0x${simulatorFixture.composeHash}`);
    expect(result.appId).toBe(simulatorFixture.appId);
    expect(result.rtmr3).toBe(simulatorFixture.sdkReplayedRtmrs[3]);
    expect(result.keyProvider).toBe("kms");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("DCAP"),
        expect.stringContaining("sha256(app-compose)"),
        expect.stringContaining("public_logs"),
      ]),
    );
  });

  it("rejects a report_data bound to another enclave key", async () => {
    const result = await verifyAttestation({ ...simulatedInput, enclavePk: "33".repeat(32) });
    expect(result).toMatchObject({ ok: false, code: "report_data_mismatch", simulated: true });
  });

  it("rejects a report_data made for another nonce (replayed quote)", async () => {
    const result = await verifyAttestation({ ...simulatedInput, nonce: "02".repeat(32) });
    expect(result).toMatchObject({ ok: false, code: "report_data_mismatch" });
  });

  it("still replays RTMR3: a tampered event log is rejected", async () => {
    const events = JSON.parse(simulatorFixture.eventLog) as { event: string; event_payload: string }[];
    const forged = events.map((e) => (e.event === "app-id" ? { ...e, event_payload: "00".repeat(20) } : e));
    const result = await verifyAttestation({ ...simulatedInput, eventLog: JSON.stringify(forged) });
    expect(result).toMatchObject({ ok: false, code: "event_digest_mismatch" });
  });

  it("rejects a quote whose RTMR3 was altered", async () => {
    const result = await verifyAttestation({
      ...simulatedInput,
      quote: flipByte(simulatorFixture.quote, 48 + 472),
    });
    expect(result).toMatchObject({ ok: false, code: "rtmr_mismatch" });
  });

  it("enforces a pinned compose hash and app id", async () => {
    expect(
      await verifyAttestation({ ...simulatedInput, expectedComposeHash: "aa".repeat(32) }),
    ).toMatchObject({
      ok: false,
      code: "compose_hash_mismatch",
    });
    expect(await verifyAttestation({ ...simulatedInput, expectedAppId: "aa".repeat(20) })).toMatchObject({
      ok: false,
      code: "app_id_mismatch",
    });
    expectOk(
      await verifyAttestation({
        ...simulatedInput,
        expectedComposeHash: simulatorFixture.composeHash,
        expectedAppId: simulatorFixture.appId,
      }),
    );
  });

  it("rejects invalid input without throwing", async () => {
    const result = await verifyAttestation({ ...simulatedInput, nonce: "short" });
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("verifyAttestation, tdx mode", () => {
  const tdxInput: VerifyAttestationInput = {
    ...simulatedInput,
    mode: "tdx",
    expectedComposeHash: simulatorFixture.composeHash,
  };

  it("requires a pinned compose hash", async () => {
    const result = await verifyAttestation({ ...tdxInput, expectedComposeHash: undefined });
    expect(result).toMatchObject({ ok: false, code: "invalid_input", simulated: false });
  });

  it("rejects the simulator quote when DCAP fails (fail closed)", async () => {
    const failing: DcapVerifier = async () => {
      throw new Error("No matching TCB level found");
    };
    const result = await verifyAttestation({ ...tdxInput, dcapVerifier: failing });
    expect(result).toMatchObject({ ok: false, code: "dcap_failed", simulated: false });
  });

  it("rejects a TCB status other than UpToDate", async () => {
    const result = await verifyAttestation({ ...tdxInput, dcapVerifier: dcapWithStatus("OutOfDate") });
    expect(result).toMatchObject({ ok: false, code: "tcb_not_up_to_date" });
  });

  it("rejects the simulator bundle even with a valid signature: its compose hash is not sha256(app-compose)", async () => {
    const result = await verifyAttestation({ ...tdxInput, dcapVerifier: dcapWithStatus("UpToDate") });
    expect(result).toMatchObject({ ok: false, code: "compose_hash_mismatch" });
  });

  it("rejects a DCAP report that disagrees with the parsed quote", async () => {
    const lying: DcapVerifier = async () => ({
      status: "UpToDate",
      advisoryIds: [],
      rtmr3: "00".repeat(48),
      reportData: simulatorFixture.reportData,
    });
    const result = await verifyAttestation({ ...tdxInput, dcapVerifier: lying });
    expect(result).toMatchObject({ ok: false, code: "malformed_quote" });
  });

  it("accepts a consistent bundle and opens the channel end to end", async () => {
    const enclaveKey = generateX25519KeyPair();
    const client = ClientChannel.create();
    const enclave = EnclaveChannel.accept(client.hello, enclaveKey.secretKey);
    const bundle = syntheticTdxBundle(enclave.reportData);

    const result = expectOk(
      await verifyAttestation({
        quote: bundle.quote,
        eventLog: bundle.eventLog,
        appCompose: bundle.appCompose,
        enclavePk: enclave.enclavePk,
        nonce: client.hello.nonce,
        clientPk: client.hello.clientPk,
        expectedComposeHash: bundle.composeHash,
        mode: "tdx",
        dcapVerifier: dcapWithStatus("UpToDate"),
      }),
    );
    expect(result).toMatchObject({
      simulated: false,
      tcbStatus: "UpToDate",
      composeHash: bundle.composeHash,
    });
    expect(result.warnings).toEqual(["dstack OS image not pinned (MRTD/RTMR0-2 not checked)"]);

    client.establish(result);
    expect(enclave.open(client.seal({ hello: "enclave" }))).toEqual({ hello: "enclave" });
  });

  it("rejects a non-compliant compose and a debug TD", async () => {
    const client = ClientChannel.create();
    const enclave = EnclaveChannel.accept(client.hello, generateX25519KeyPair().secretKey);
    const base = {
      enclavePk: enclave.enclavePk,
      nonce: client.hello.nonce,
      clientPk: client.hello.clientPk,
      mode: "tdx" as const,
      dcapVerifier: dcapWithStatus("UpToDate"),
    };
    const leaky = syntheticTdxBundle(
      enclave.reportData,
      JSON.stringify({ kms_enabled: true, public_logs: true }),
    );
    expect(
      await verifyAttestation({ ...base, ...leaky, expectedComposeHash: leaky.composeHash }),
    ).toMatchObject({
      ok: false,
      code: "compose_policy_violation",
    });

    const good = syntheticTdxBundle(enclave.reportData);
    const debugQuote = flipByte(good.quote, 48 + 120);
    expect(
      await verifyAttestation({ ...base, ...good, quote: debugQuote, expectedComposeHash: good.composeHash }),
    ).toMatchObject({ ok: false, code: "debug_td" });
  });

  it("enforces pinned OS measurements", async () => {
    const client = ClientChannel.create();
    const enclave = EnclaveChannel.accept(client.hello, generateX25519KeyPair().secretKey);
    const bundle = syntheticTdxBundle(enclave.reportData);
    const quote = parseTdxQuote(bundle.quote);
    const os = { mrtd: quote.mrtd, rtmr0: quote.rtmrs[0], rtmr1: quote.rtmrs[1], rtmr2: quote.rtmrs[2] };
    const input: VerifyAttestationInput = {
      ...bundle,
      enclavePk: enclave.enclavePk,
      nonce: client.hello.nonce,
      clientPk: client.hello.clientPk,
      expectedComposeHash: bundle.composeHash,
      mode: "tdx",
      dcapVerifier: dcapWithStatus("UpToDate"),
      expectedOsMeasurements: os,
    };
    expect(expectOk(await verifyAttestation(input)).warnings).toEqual([]);
    const wrongOs = { ...os, mrtd: "00".repeat(48) };
    expect(await verifyAttestation({ ...input, expectedOsMeasurements: wrongOs })).toMatchObject({
      ok: false,
      code: "os_measurement_mismatch",
    });
  });
});
