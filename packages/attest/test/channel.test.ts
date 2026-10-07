import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeHex, toHex } from "../src/bytes";
import {
  channelReportData,
  ClientChannel,
  EnclaveChannel,
  generateX25519KeyPair,
  type ChannelAttestation,
  type SealedMessage,
} from "../src/channel";
import { ChannelError } from "../src/errors";
import { flipByte } from "./helpers";

/** Stands in for a successful `verifyAttestation` result (covered in verify.test.ts). */
function attestationFor(client: ClientChannel, enclave: EnclaveChannel): ChannelAttestation {
  return {
    ok: true,
    nonce: client.hello.nonce,
    clientPk: client.hello.clientPk,
    enclavePk: enclave.enclavePk,
  };
}

function openChannel() {
  const enclaveKey = generateX25519KeyPair();
  const client = ClientChannel.create();
  const enclave = EnclaveChannel.accept(client.hello, enclaveKey.secretKey);
  client.establish(attestationFor(client, enclave));
  return { client, enclave, enclaveKey };
}

describe("attested channel", () => {
  it("binds nonce and both keys in the report data", () => {
    const enclaveKey = generateX25519KeyPair();
    const client = ClientChannel.create();
    const enclave = EnclaveChannel.accept(client.hello, enclaveKey.secretKey);
    expect(enclave.enclavePk).toBe(toHex(enclaveKey.publicKey));
    expect(toHex(enclave.reportData)).toBe(
      toHex(
        channelReportData(
          decodeHex(client.hello.nonce, "nonce"),
          decodeHex(client.hello.clientPk, "clientPk"),
          enclaveKey.publicKey,
        ),
      ),
    );
    expect(enclave.reportData).toHaveLength(64);
  });

  it("round-trips JSON payloads in both directions", () => {
    const { client, enclave } = openChannel();
    expect(client.channelId).toBe(enclave.channelId);
    for (let i = 0; i < 3; i++) {
      expect(enclave.open(client.seal({ ask: "brief", i }))).toEqual({ ask: "brief", i });
      expect(client.open(enclave.seal({ answer: [1, 2, 3], i }))).toEqual({ answer: [1, 2, 3], i });
    }
  });

  it("validates decrypted payloads with a zod schema", () => {
    const { client, enclave } = openChannel();
    const schema = z.object({ task: z.string() });
    expect(enclave.open(client.seal({ task: "brief" }), schema)).toEqual({ task: "brief" });
    expect(() => enclave.open(client.seal({ task: 42 }), schema)).toThrow(ChannelError);
  });

  it("rejects a tampered ciphertext without desynchronising the channel", () => {
    const { client, enclave } = openChannel();
    const sealed = client.seal({ secret: "notes" });
    const tampered: SealedMessage = { ...sealed, ciphertext: flipByte(sealed.ciphertext, 0) };
    expect(() => enclave.open(tampered)).toThrow(expect.objectContaining({ code: "channel_auth_failed" }));
    expect(enclave.open(sealed)).toEqual({ secret: "notes" });
  });

  it("rejects a message whose sequence number was rewritten", () => {
    const { client, enclave } = openChannel();
    enclave.open(client.seal("first"));
    const second = client.seal("second");
    expect(() => enclave.open({ ...second, seq: 0 })).toThrow(
      expect.objectContaining({ code: "channel_sequence" }),
    );
  });

  it("rejects a replayed message", () => {
    const { client, enclave } = openChannel();
    const sealed = client.seal("once");
    enclave.open(sealed);
    expect(() => enclave.open(sealed)).toThrow(expect.objectContaining({ code: "channel_sequence" }));
  });

  it("rejects reordered messages", () => {
    const { client, enclave } = openChannel();
    client.seal("first");
    const second = client.seal("second");
    expect(() => enclave.open(second)).toThrow(expect.objectContaining({ code: "channel_sequence" }));
  });

  it("rejects a message reflected back to its sender", () => {
    const { client } = openChannel();
    expect(() => client.open(client.seal("echo"))).toThrow(
      expect.objectContaining({ code: "channel_auth_failed" }),
    );
  });

  it("rejects a message from another channel", () => {
    const a = openChannel();
    const b = openChannel();
    expect(() => a.enclave.open(b.client.seal("x"))).toThrow(
      expect.objectContaining({ code: "channel_mismatch" }),
    );
  });

  it("refuses to send before the attestation was verified", () => {
    const client = ClientChannel.create();
    expect(() => client.seal("too early")).toThrow(expect.objectContaining({ code: "channel_unverified" }));
  });

  it("refuses an attestation made for another handshake", () => {
    const enclaveKey = generateX25519KeyPair();
    const client = ClientChannel.create();
    const other = ClientChannel.create();
    const enclave = EnclaveChannel.accept(other.hello, enclaveKey.secretKey);
    expect(() => client.establish(attestationFor(other, enclave))).toThrow(
      expect.objectContaining({ code: "channel_unverified" }),
    );
  });

  it("cannot be read by a man in the middle that substituted the enclave key", () => {
    const client = ClientChannel.create();
    const genuine = EnclaveChannel.accept(client.hello, generateX25519KeyPair().secretKey);
    const attacker = EnclaveChannel.accept(client.hello, generateX25519KeyPair().secretKey);
    // The client verified the genuine enclave (its key is in the quote); the attacker cannot decrypt.
    client.establish(attestationFor(client, genuine));
    expect(() => attacker.open(client.seal("secret"))).toThrow(ChannelError);
  });

  it("rejects malformed hellos and messages", () => {
    const key = generateX25519KeyPair().secretKey;
    expect(() => EnclaveChannel.accept({ nonce: "00", clientPk: "11" }, key)).toThrow(ChannelError);
    expect(() => EnclaveChannel.accept(null, key)).toThrow(ChannelError);
    const { enclave } = openChannel();
    expect(() => enclave.open({ seq: -1 })).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });
});
