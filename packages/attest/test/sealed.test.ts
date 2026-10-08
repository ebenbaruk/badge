import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { generateX25519KeyPair } from "../src/channel";
import {
  complianceKeyDeriveMessage,
  complianceKeyFromSignature,
  complianceKeyRegistrationMessage,
} from "../src/compliance";
import { openSealed, sealToPublicKey } from "../src/sealed";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("sealed boxes", () => {
  it("round-trips text and bytes, with a fresh ephemeral key each time", () => {
    const { secretKey, publicKey } = generateX25519KeyPair();
    const first = sealToPublicKey(publicKey, "signer: bob");
    const second = sealToPublicKey(publicKey, "signer: bob");
    expect(first.epk).not.toBe(second.epk);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(decode(openSealed(secretKey, first))).toBe("signer: bob");
    expect(openSealed(secretKey, sealToPublicKey(publicKey, new Uint8Array([1, 2, 3])))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("survives a JSON round trip and accepts a hex public key", () => {
    const { secretKey, publicKey } = generateX25519KeyPair();
    const hexKey = Buffer.from(publicKey).toString("hex");
    const stored = JSON.parse(JSON.stringify(sealToPublicKey(`0x${hexKey}`, "é ünïcode")));
    expect(decode(openSealed(secretKey, stored))).toBe("é ünïcode");
  });

  it("refuses another recipient's key", () => {
    const alice = generateX25519KeyPair();
    const mallory = generateX25519KeyPair();
    const box = sealToPublicKey(alice.publicKey, "secret");
    expect(() => openSealed(mallory.secretKey, box)).toThrow(
      expect.objectContaining({ code: "sealed_box_auth_failed" }),
    );
  });

  it("refuses tampered ciphertext, nonce or ephemeral key", () => {
    const { secretKey, publicKey } = generateX25519KeyPair();
    const box = sealToPublicKey(publicKey, "secret");
    const flip = (hex: string) => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
    for (const field of ["ciphertext", "nonce", "epk"] as const) {
      const tampered = { ...box, [field]: flip(box[field]) };
      expect(() => openSealed(secretKey, tampered)).toThrow();
    }
  });

  it("rejects malformed envelopes and keys", () => {
    const { secretKey, publicKey } = generateX25519KeyPair();
    const box = sealToPublicKey(publicKey, "x");
    expect(() => openSealed(secretKey, { ...box, v: 2 })).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(() => openSealed(secretKey, { ...box, extra: 1 })).toThrow(/malformed/);
    expect(() => openSealed(new Uint8Array(16), box)).toThrow(/32 bytes/);
    expect(() => sealToPublicKey("abcd", "x")).toThrow(/32 bytes/);
    // A low-order point would give an all-zero shared secret.
    expect(() => sealToPublicKey(new Uint8Array(32), "x")).toThrow(/invalid/);
  });
});

describe("compliance key", () => {
  // Stand-in for the officer's Ledger: any deterministic secp256k1 signer behaves the same way.
  const officer = privateKeyToAccount(`0x${"42".repeat(32)}`);

  it("is derived deterministically from the Ledger signature and opens boxes sealed to it", async () => {
    const message = complianceKeyDeriveMessage("Acme");
    const signature = await officer.signMessage({ message });
    const again = await officer.signMessage({ message });
    const key = complianceKeyFromSignature(signature);
    expect(complianceKeyFromSignature(again)).toEqual(key);

    const box = sealToPublicKey(key.publicKey, "bob");
    expect(decode(openSealed(complianceKeyFromSignature(signature).secretKey, box))).toBe("bob");
  });

  it("depends on the signature (another signer gets another key)", async () => {
    const message = complianceKeyDeriveMessage("Acme");
    const other = privateKeyToAccount(`0x${"43".repeat(32)}`);
    const mine = complianceKeyFromSignature(await officer.signMessage({ message }));
    const theirs = complianceKeyFromSignature(await other.signMessage({ message }));
    expect(theirs.publicKey).not.toEqual(mine.publicKey);
  });

  it("validates inputs and keeps Ledger messages ASCII", () => {
    expect(() => complianceKeyFromSignature("0x1234")).toThrow(/65 bytes/);
    expect(() => complianceKeyDeriveMessage("Acmé")).toThrow(/ASCII/);
    const registration = complianceKeyRegistrationMessage("Acme", `0x${"AB".repeat(32)}`);
    expect(registration).toContain(`Key: ${"ab".repeat(32)}`);
    expect(() => complianceKeyRegistrationMessage("Acme", "00")).toThrow(/32 bytes/);
  });
});
