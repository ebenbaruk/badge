import { describe, expect, it } from "vitest";
import {
  BADGE_MESSAGE_KINDS,
  BADGE_TYPES,
  BADGE_WIRE_SCHEMAS,
  decodeBadgeMessage,
  decodeSignedMessage,
  encodeBadgeMessage,
  encodeSignedMessage,
  InvalidMessageError,
} from "../src";
import { alice, KINDS, MESSAGES, signAs } from "./fixtures";

describe("wire schemas", () => {
  it("cover every message kind", () => {
    expect([...BADGE_MESSAGE_KINDS].sort()).toEqual(Object.keys(BADGE_TYPES).sort());
  });

  it.each(KINDS)("%s: keys match the EIP-712 struct exactly", (kind) => {
    expect(Object.keys(BADGE_WIRE_SCHEMAS[kind].shape)).toEqual(BADGE_TYPES[kind].map((field) => field.name));
  });

  it.each(KINDS)("%s: round-trips through JSON", (kind) => {
    const wire = encodeBadgeMessage(kind, MESSAGES[kind]);
    const json: unknown = JSON.parse(JSON.stringify(wire));
    expect(decodeBadgeMessage(kind, json)).toEqual(MESSAGES[kind]);
  });

  it("encodes bigints as decimal strings", () => {
    const wire = encodeBadgeMessage("ContextShare", MESSAGES.ContextShare);
    expect(wire.expiresAt).toBe(MESSAGES.ContextShare.expiresAt.toString());
    expect(wire.excerptLength).toBe(MESSAGES.ContextShare.excerptLength);
  });
});

describe("decodeBadgeMessage rejects", () => {
  const valid = () => encodeBadgeMessage("ContextShare", MESSAGES.ContextShare) as Record<string, unknown>;
  it.each<[string, Record<string, unknown>]>([
    ["unknown key", { extra: 1 }],
    ["missing key", { nonce: undefined }],
    ["non-ASCII displayed string", { recipientName: "Bob (Équipe)" }],
    ["non-canonical spacing", { recipientName: "Bob  (Sales)" }],
    ["empty string", { taskLabel: "" }],
    ["too long string", { taskLabel: "x".repeat(257) }],
    ["bigint as number", { expiresAt: 123 }],
    ["hex bigint", { expiresAt: "0x10" }],
    ["leading zero", { expiresAt: "0123" }],
    ["negative", { nonce: "-1" }],
    ["uint64 overflow", { expiresAt: (2n ** 64n).toString() }],
    ["uint32 overflow", { excerptLength: 2 ** 32 }],
    ["fractional uint32", { excerptLength: 1.5 }],
    ["short bytes32", { excerptHash: "0x1234" }],
    ["bytes32 without 0x", { excerptHash: "ab".repeat(32) }],
    ["bad address", { owner: "0x1234" }],
    ["bad checksum", { owner: "0xF39fd6e51aad88F6F4ce6aB8827279cffFb92266" }],
  ])("%s", (_name, patch) => {
    expect(() => decodeBadgeMessage("ContextShare", { ...valid(), ...patch })).toThrow(InvalidMessageError);
  });

  it("non-objects", () => {
    expect(() => decodeBadgeMessage("ContextShare", null)).toThrow(InvalidMessageError);
    expect(() => decodeBadgeMessage("ContextShare", "{}")).toThrow(InvalidMessageError);
  });
});

describe("signed messages", () => {
  it("round-trip and keep the kind discriminant", async () => {
    const signature = await signAs(alice, "ContextShare", MESSAGES.ContextShare);
    const wire = encodeSignedMessage({ kind: "ContextShare", message: MESSAGES.ContextShare, signature });
    const json: unknown = JSON.parse(JSON.stringify(wire));
    const decoded = decodeSignedMessage(json);
    expect(decoded.kind).toBe("ContextShare");
    expect(decoded).toEqual({ kind: "ContextShare", message: MESSAGES.ContextShare, signature });
    expect(decodeSignedMessage(json, "ContextShare").message.owner).toBe(alice.address);
  });

  it("reject an unexpected kind", async () => {
    const signature = await signAs(alice, "ContextPolicy", MESSAGES.ContextPolicy);
    const json = encodeSignedMessage({ kind: "ContextPolicy", message: MESSAGES.ContextPolicy, signature });
    expect(() => decodeSignedMessage(json, "ContextShare")).toThrow(InvalidMessageError);
  });

  it("reject a message that does not match its kind, and malformed signatures", async () => {
    const signature = await signAs(alice, "ContextShare", MESSAGES.ContextShare);
    const wire = encodeSignedMessage({ kind: "ContextShare", message: MESSAGES.ContextShare, signature });
    expect(() => decodeSignedMessage({ ...wire, kind: "ContextPolicy" })).toThrow(InvalidMessageError);
    expect(() => decodeSignedMessage({ ...wire, signature: signature.slice(0, -2) })).toThrow(
      InvalidMessageError,
    );
    expect(() => decodeSignedMessage({ ...wire, kind: "Unknown" })).toThrow(InvalidMessageError);
  });

  it("refuse to encode out-of-range values", () => {
    expect(() =>
      encodeBadgeMessage("ContextShare", { ...MESSAGES.ContextShare, expiresAt: 2n ** 64n }),
    ).toThrow(InvalidMessageError);
  });
});
