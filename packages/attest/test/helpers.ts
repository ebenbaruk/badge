import { readFileSync } from "node:fs";
import { sha384 } from "@noble/hashes/sha2";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { z } from "zod";
import { composeHashOf } from "../src/compose";
import { DSTACK_RUNTIME_EVENT_TYPE, parseEventLog, runtimeEventDigest, type DstackEvent } from "../src/rtmr";

const fixtureSchema = z.object({
  nonce: z.string(),
  clientPk: z.string(),
  enclavePk: z.string(),
  reportData: z.string(),
  quote: z.string(),
  eventLog: z.string(),
  appCompose: z.string(),
  appId: z.string(),
  composeHash: z.string(),
  sdkReplayedRtmrs: z.array(z.string()).length(4),
});

/** Bundle captured from the dstack 0.5.3 simulator for a fixed handshake (see fixtures/simulator-bundle.json). */
export const simulatorFixture = fixtureSchema.parse(
  JSON.parse(readFileSync(new URL("./fixtures/simulator-bundle.json", import.meta.url), "utf8")),
);

/** A compliant app-compose for a Badge deployment (confidentiality flags off, KMS on). */
export const COMPLIANT_COMPOSE = JSON.stringify({
  manifest_version: 2,
  name: "badge-enclave",
  runner: "docker-compose",
  docker_compose_file:
    "services:\n  enclave:\n    image: ghcr.io/example/badge@sha256:" + "0".repeat(64) + "\n",
  kms_enabled: true,
  gateway_enabled: true,
  public_logs: false,
  public_sysinfo: false,
  public_tcbinfo: true,
  local_key_provider_enabled: false,
  allowed_envs: [],
  no_instance_id: false,
});

const HEADER_LENGTH = 48;
const RTMR3_OFFSET = HEADER_LENGTH + 472;
const REPORT_DATA_OFFSET = HEADER_LENGTH + 520;

function runtimeEvent(event: string, payloadHex: string): DstackEvent {
  return {
    imr: 3,
    event_type: DSTACK_RUNTIME_EVENT_TYPE,
    digest: runtimeEventDigest(DSTACK_RUNTIME_EVENT_TYPE, event, payloadHex),
    event,
    event_payload: payloadHex,
  };
}

function replay(digests: string[]): Uint8Array {
  let register: Uint8Array = new Uint8Array(48);
  for (const digest of digests) register = sha384(concatBytes(register, hexToBytes(digest)));
  return register;
}

/**
 * Builds a self-consistent "real-looking" TDX bundle: the simulator quote with RTMR3 and report_data patched so
 * that a compliant compose, its compose hash and a kms key provider are attested. Its signature is of course
 * invalid, so tests pair it with a stubbed DCAP verifier: this exercises every non-DCAP check of `tdx` mode.
 */
export function syntheticTdxBundle(reportData: Uint8Array, appCompose = COMPLIANT_COMPOSE) {
  const baseEvents = parseEventLog(simulatorFixture.eventLog).filter((e) => e.imr !== 3);
  const keyProvider = bytesToHex(utf8ToBytes(JSON.stringify({ name: "kms", id: "00" })));
  const runtimeEvents = [
    runtimeEvent("system-preparing", ""),
    runtimeEvent("app-id", simulatorFixture.appId),
    runtimeEvent("compose-hash", composeHashOf(appCompose)),
    runtimeEvent("key-provider", keyProvider),
    runtimeEvent("system-ready", ""),
  ];
  const quote = hexToBytes(simulatorFixture.quote);
  quote.set(replay(runtimeEvents.map((e) => e.digest)), RTMR3_OFFSET);
  quote.set(reportData, REPORT_DATA_OFFSET);
  return {
    quote: bytesToHex(quote),
    eventLog: JSON.stringify([...baseEvents, ...runtimeEvents]),
    appCompose,
    composeHash: composeHashOf(appCompose),
  };
}

/** Bytes of a hex string, mutated at `index` (to forge tampered inputs). */
export function flipByte(hex: string, index: number): string {
  const bytes = hexToBytes(hex);
  bytes[index] = (bytes[index] ?? 0) ^ 0xff;
  return bytesToHex(bytes);
}
