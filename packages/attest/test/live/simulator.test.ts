/**
 * Integration test against the local dstack simulator: `infra/dstack-sim.sh start`, then `pnpm test:sim`.
 * The tdx-mode case also reaches Phala's PCCS over the network to fetch DCAP collateral.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ClientChannel, EnclaveChannel } from "../../src/channel";
import {
  createAttestationBundle,
  createDstackClient,
  deriveChannelKeyPair,
  deriveEnclaveKey,
  DSTACK_SIMULATOR_ENDPOINT_ENV,
  ENCLAVE_KEY_PATHS,
} from "../../src/server";
import { verifyAttestation } from "../../src/verify";

const DEFAULT_SIMULATOR_ENDPOINT = "http://127.0.0.1:8090";
const NETWORK_TIMEOUT_MS = 30_000;

const endpoint = process.env[DSTACK_SIMULATOR_ENDPOINT_ENV] ?? DEFAULT_SIMULATOR_ENDPOINT;
const dstack = createDstackClient(endpoint);

beforeAll(async () => {
  if (!(await dstack.isReachable())) {
    throw new Error(`dstack simulator not reachable at ${endpoint}: run infra/dstack-sim.sh start`);
  }
});

async function handshakeWithSimulator() {
  const client = ClientChannel.create();
  const { secretKey } = await deriveChannelKeyPair(dstack);
  const enclave = EnclaveChannel.accept(client.hello, secretKey);
  const bundle = await createAttestationBundle(dstack, { ...client.hello, enclavePk: enclave.enclavePk });
  return { client, enclave, bundle };
}

describe("dstack simulator", () => {
  it("attests a fresh channel in simulated mode and carries messages", async () => {
    const { client, enclave, bundle } = await handshakeWithSimulator();
    const result = await verifyAttestation({ ...bundle, ...client.hello, mode: "simulated" });
    if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);
    expect(result.simulated).toBe(true);
    expect(result.enclaveMeasurement).toMatch(/^0x[0-9a-f]{64}$/);

    client.establish(result);
    expect(enclave.open(client.seal({ question: "brief" }))).toEqual({ question: "brief" });
    expect(client.open(enclave.seal({ answer: "ok" }))).toEqual({ answer: "ok" });
  });

  it("derives deterministic, path-separated keys", async () => {
    const bob1 = await deriveEnclaveKey(dstack, ENCLAVE_KEY_PATHS.employeeDek("bob"));
    const bob2 = await deriveEnclaveKey(dstack, ENCLAVE_KEY_PATHS.employeeDek("bob"));
    const alice = await deriveEnclaveKey(dstack, ENCLAVE_KEY_PATHS.employeeDek("alice"));
    expect(bob1).toEqual(bob2);
    expect(alice).not.toEqual(bob1);
  });

  it(
    "rejects the simulator quote in tdx mode with the real DCAP verifier",
    async () => {
      const { client, bundle } = await handshakeWithSimulator();
      const result = await verifyAttestation({
        ...bundle,
        ...client.hello,
        mode: "tdx",
        expectedComposeHash: "00".repeat(32),
      });
      // The simulator patches report_data into a fixed quote, which breaks the Intel signature.
      expect(result).toMatchObject({
        ok: false,
        code: "DCAP_FAILED",
        simulated: false,
        reason: expect.stringContaining("signature is invalid"),
      });
    },
    NETWORK_TIMEOUT_MS,
  );
});
