import { hashTypedData, keccak256, stringToBytes, type TypedDataDefinition } from "viem";
import { describe, expect, it } from "vitest";
import {
  BADGE_DESCRIPTORS,
  BADGE_DOMAIN,
  BADGE_TYPES,
  badgeTypedData,
  deskIdentityDeriveMessage,
  excerptLength,
  hashBadgeMessage,
  hashExcerpt,
  isDeviceAscii,
  taskIdFrom,
} from "../src";
import { KINDS, MESSAGES } from "./fixtures";

describe("descriptor invariants", () => {
  it.each(KINDS)("%s: displayed fields are the struct's leading fields, in struct order", (kind) => {
    const structNames: string[] = BADGE_TYPES[kind].map((field) => field.name);
    const paths = BADGE_DESCRIPTORS[kind].fields.map((field) => field.path);
    for (const path of paths) expect(structNames).toContain(path);
    // The device shows fields in struct order: the descriptor must list them in that same relative order...
    const indexes = paths.map((path) => structNames.indexOf(path));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    // ...and, as documented in messages.ts, displayed fields come first, before hidden technical fields.
    expect(paths).toEqual(structNames.slice(0, paths.length));
  });

  it.each(KINDS)("%s: intent and labels are device ASCII, datetime only on uint64", (kind) => {
    const descriptor = BADGE_DESCRIPTORS[kind];
    expect(isDeviceAscii(descriptor.intent)).toBe(true);
    for (const field of descriptor.fields) {
      expect(isDeviceAscii(field.label), field.label).toBe(true);
      const type = BADGE_TYPES[kind].find((entry) => entry.name === field.path)?.type;
      if (field.format === "datetime") expect(type).toBe("uint64");
    }
  });
});

describe("badgeTypedData", () => {
  it.each(KINDS)("%s: carries EIP712Domain and only its own struct", (kind) => {
    const typedData = badgeTypedData(kind, MESSAGES[kind]);
    expect(typedData.domain).toBe(BADGE_DOMAIN);
    expect(typedData.primaryType).toBe(kind);
    expect(Object.keys(typedData.types).sort()).toEqual(["EIP712Domain", kind].sort());
  });

  it.each(KINDS)("%s: explicit EIP712Domain does not change the digest viem infers", (kind) => {
    const { EIP712Domain: _domainType, ...types } = badgeTypedData(kind, MESSAGES[kind]).types as Record<
      string,
      unknown
    >;
    const inferred = hashTypedData({
      domain: BADGE_DOMAIN,
      types,
      primaryType: kind,
      message: MESSAGES[kind],
    } as unknown as TypedDataDefinition);
    expect(hashBadgeMessage(kind, MESSAGES[kind])).toBe(inferred);
  });

  it("gives distinct grant ids to distinct messages", () => {
    const share = MESSAGES.ContextShare;
    expect(hashBadgeMessage("ContextShare", share)).not.toBe(
      hashBadgeMessage("ContextShare", { ...share, nonce: share.nonce + 1n }),
    );
  });
});

describe("excerpt helpers", () => {
  it("hashes the exact UTF-8 bytes", () => {
    expect(hashExcerpt("é")).toBe(keccak256(stringToBytes("é")));
    // NFC and NFD forms render the same but are different bytes, hence different consents.
    expect(hashExcerpt("é".normalize("NFC"))).not.toBe(hashExcerpt("é".normalize("NFD")));
  });

  it("counts code points, not UTF-16 units", () => {
    expect(excerptLength("a🚀é")).toBe(3);
  });

  it("derives task ids from label and salt", () => {
    const salt = `0x${"01".repeat(32)}` as const;
    expect(taskIdFrom("a", salt)).toBe(taskIdFrom("a", salt));
    expect(taskIdFrom("a", salt)).not.toBe(taskIdFrom("b", salt));
    expect(taskIdFrom("a", salt)).not.toBe(taskIdFrom("a", `0x${"02".repeat(32)}`));
  });
});

describe("deskIdentityDeriveMessage", () => {
  it("is fully device ASCII per line", () => {
    for (const line of deskIdentityDeriveMessage("Société Générale").split("\n")) {
      expect(isDeviceAscii(line), line).toBe(true);
    }
  });
});
