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
    expect(result).toMatchObject({ ok: false, code: "REPORT_DATA_MISMATCH", simulated: true });
  });

  it("rejects a report_data made for another nonce (replayed quote)", async () => {
    const result = await verifyAttestation({ ...simulatedInput, nonce: "02".repeat(32) });
    expect(result).toMatchObject({ ok: false, code: "REPORT_DATA_MISMATCH" });
  });

  it("still replays RTMR3: a tampered event log is rejected", async () => {
    const events = JSON.parse(simulatorFixture.eventLog) as { event: string; event_payload: string }[];
    const forged = events.map((e) => (e.event === "app-id" ? { ...e, event_payload: "00".repeat(20) } : e));
    const result = await verifyAttestation({ ...simulatedInput, eventLog: JSON.stringify(forged) });
    expect(result).toMatchObject({ ok: false, code: "EVENT_DIGEST_MISMATCH" });
  });

  it("rejects a quote whose RTMR3 was altered", async () => {
    const result = await verifyAttestation({
      ...simulatedInput,
      quote: flipByte(simulatorFixture.quote, 48 + 472),
    });
    expect(result).toMatchObject({ ok: false, code: "RTMR_MISMATCH" });
  });

  it("enforces a pinned compose hash and app id", async () => {
    expect(
      await verifyAttestation({ ...simulatedInput, expectedComposeHash: "aa".repeat(32) }),
    ).toMatchObject({
      ok: false,
      code: "COMPOSE_HASH_MISMATCH",
    });
    expect(await verifyAttestation({ ...simulatedInput, expectedAppId: "aa".repeat(20) })).toMatchObject({
      ok: false,
      code: "APP_ID_MISMATCH",
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
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

/** The OS measurements a quote carries (what a client pins for that deployment). */
function osOf(quoteHex: string) {
  const quote = parseTdxQuote(quoteHex);
  return { mrtd: quote.mrtd, rtmr0: quote.rtmrs[0], rtmr1: quote.rtmrs[1], rtmr2: quote.rtmrs[2] };
}

describe("verifyAttestation, tdx mode", () => {
  const tdxInput: VerifyAttestationInput = {
    ...simulatedInput,
    mode: "tdx",
    expectedComposeHash: simulatorFixture.composeHash,
    expectedAppId: simulatorFixture.appId,
    expectedOsMeasurements: osOf(simulatorFixture.quote),
  };

  it.each(["expectedComposeHash", "expectedAppId", "expectedOsMeasurements"] as const)(
    "requires %s (fail closed: a dev OS or another app id running the same compose would pass)",
    async (pin) => {
      const result = await verifyAttestation({ ...tdxInput, [pin]: undefined });
      expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", simulated: false });
    },
  );

  it("rejects the simulator quote when DCAP fails (fail closed)", async () => {
    const failing: DcapVerifier = async () => {
      throw new Error("No matching TCB level found");
    };
    const result = await verifyAttestation({ ...tdxInput, dcapVerifier: failing });
    expect(result).toMatchObject({ ok: false, code: "DCAP_FAILED", simulated: false });
  });

  it("rejects a TCB status other than UpToDate", async () => {
    const result = await verifyAttestation({ ...tdxInput, dcapVerifier: dcapWithStatus("OutOfDate") });
    expect(result).toMatchObject({ ok: false, code: "TCB_NOT_UP_TO_DATE" });
  });

  it("rejects the simulator bundle even with a valid signature: its compose hash is not sha256(app-compose)", async () => {
    const result = await verifyAttestation({ ...tdxInput, dcapVerifier: dcapWithStatus("UpToDate") });
    expect(result).toMatchObject({ ok: false, code: "COMPOSE_HASH_MISMATCH" });
  });

  it("rejects a DCAP report that disagrees with the parsed quote", async () => {
    const lying: DcapVerifier = async () => ({
      status: "UpToDate",
      advisoryIds: [],
      rtmr3: "00".repeat(48),
      reportData: simulatorFixture.reportData,
    });
    const result = await verifyAttestation({ ...tdxInput, dcapVerifier: lying });
    expect(result).toMatchObject({ ok: false, code: "MALFORMED_QUOTE" });
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
        expectedAppId: simulatorFixture.appId,
        expectedOsMeasurements: osOf(bundle.quote),
        mode: "tdx",
        dcapVerifier: dcapWithStatus("UpToDate"),
      }),
    );
    expect(result).toMatchObject({
      simulated: false,
      tcbStatus: "UpToDate",
      composeHash: bundle.composeHash,
    });
    expect(result.warnings).toEqual([]);

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
      expectedAppId: simulatorFixture.appId,
      expectedOsMeasurements: osOf(simulatorFixture.quote),
    };
    const leaky = syntheticTdxBundle(
      enclave.reportData,
      JSON.stringify({ kms_enabled: true, public_logs: true }),
    );
    expect(
      await verifyAttestation({ ...base, ...leaky, expectedComposeHash: leaky.composeHash }),
    ).toMatchObject({
      ok: false,
      code: "COMPOSE_POLICY_VIOLATION",
    });

    const good = syntheticTdxBundle(enclave.reportData);
    const debugQuote = flipByte(good.quote, 48 + 120);
    expect(
      await verifyAttestation({ ...base, ...good, quote: debugQuote, expectedComposeHash: good.composeHash }),
    ).toMatchObject({ ok: false, code: "DEBUG_TD" });
  });

  it("enforces pinned OS measurements", async () => {
    const client = ClientChannel.create();
    const enclave = EnclaveChannel.accept(client.hello, generateX25519KeyPair().secretKey);
    const bundle = syntheticTdxBundle(enclave.reportData);
    const os = osOf(bundle.quote);
    const input: VerifyAttestationInput = {
      ...bundle,
      enclavePk: enclave.enclavePk,
      nonce: client.hello.nonce,
      clientPk: client.hello.clientPk,
      expectedComposeHash: bundle.composeHash,
      mode: "tdx",
      dcapVerifier: dcapWithStatus("UpToDate"),
      expectedAppId: simulatorFixture.appId,
      expectedOsMeasurements: os,
    };
    expect(expectOk(await verifyAttestation(input)).warnings).toEqual([]);
    const wrongOs = { ...os, mrtd: "00".repeat(48) };
    expect(await verifyAttestation({ ...input, expectedOsMeasurements: wrongOs })).toMatchObject({
      ok: false,
      code: "OS_MEASUREMENT_MISMATCH",
    });
    expect(await verifyAttestation({ ...input, expectedAppId: "aa".repeat(20) })).toMatchObject({
      ok: false,
      code: "APP_ID_MISMATCH",
    });
  });

  it("checks the pinned KMS identity when given", async () => {
    const client = ClientChannel.create();
    const enclave = EnclaveChannel.accept(client.hello, generateX25519KeyPair().secretKey);
    const bundle = syntheticTdxBundle(enclave.reportData);
    const input: VerifyAttestationInput = {
      ...bundle,
      enclavePk: enclave.enclavePk,
      nonce: client.hello.nonce,
      clientPk: client.hello.clientPk,
      expectedComposeHash: bundle.composeHash,
      expectedAppId: simulatorFixture.appId,
      expectedOsMeasurements: osOf(bundle.quote),
      mode: "tdx",
      dcapVerifier: dcapWithStatus("UpToDate"),
    };
    // The synthetic bundle's KMS id is "00".
    expect(expectOk(await verifyAttestation({ ...input, expectedKeyProviderId: "00" })).ok).toBe(true);
    expect(await verifyAttestation({ ...input, expectedKeyProviderId: "ff" })).toMatchObject({
      ok: false,
      code: "KEY_PROVIDER_MISMATCH",
    });
  });
});
