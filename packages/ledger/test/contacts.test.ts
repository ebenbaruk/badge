import { generateKeyPairSync, sign, verify } from "node:crypto";
import { BADGE_DOMAIN } from "@badge/consent";
import { DeviceModelId } from "@ledgerhq/device-management-kit";
import { describe, expect, it } from "vitest";
import { BadgeClearSignLoader, badgeSchema, badgeSchemaHash, contactFilterPayload } from "../src/clearSign";
import {
  ContactProofSchema,
  SUGGESTED_CONTACT_FIELDS,
  provideContactApdus,
  type ContactProof,
} from "../src/contacts";
import { ClearSignSetupError } from "../src/errors";

const proof: ContactProof = ContactProofSchema.parse({
  contactName: "Alice (Ventes)",
  scope: "Badge",
  address: "0x9858effd232b4033e47d90003d41ec34ecaeda94",
  chainId: 1,
  groupHandle: `0x${"11".repeat(64)}`,
  hmacProof: `0x${"22".repeat(32)}`,
  hmacRest: `0x${"33".repeat(32)}`,
});

describe("ContactProofSchema", () => {
  it("checksums the address", () => {
    expect(proof.address).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  });

  it("refuses non-ASCII names and malformed proofs", () => {
    expect(ContactProofSchema.safeParse({ ...proof, contactName: "Chloé" }).success).toBe(false);
    expect(ContactProofSchema.safeParse({ ...proof, hmacProof: "0x1234" }).success).toBe(false);
  });
});

describe("provideContactApdus", () => {
  it("frames the payload with a length prefix in 255-byte chunks", () => {
    const apdus = provideContactApdus(proof);
    const first = apdus[0];
    expect(first?.subarray(0, 4)).toEqual(Uint8Array.from([0xb0, 0x10, 0x20, 0x00]));
    const totalData = apdus.reduce((sum, apdu) => sum + (apdu[4] ?? 0), 0);
    const declaredLength = ((first?.[5] ?? 0) << 8) | (first?.[6] ?? 0);
    expect(totalData).toBe(declaredLength + 2);
    for (const [index, apdu] of apdus.entries()) {
      expect(apdu[3]).toBe(index === 0 ? 0x00 : 0x80);
      expect(apdu[4]).toBeLessThanOrEqual(255);
    }
  });
});

describe("contact filter", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });

  const signer = (payload: Uint8Array) =>
    sign("sha256", payload, { key: privateKey, dsaEncoding: "der" }).toString("hex");
  const field = SUGGESTED_CONTACT_FIELDS.ContextShare;

  it("adds a signed trusted-name filter on the address field", async () => {
    if (field === undefined) throw new Error("ContextShare contact field missing");
    const loader = new BadgeClearSignLoader(signer, { ContextShare: field });
    const context = await loader.load({
      deviceModelId: DeviceModelId.FLEX,
      verifyingContract: BADGE_DOMAIN.verifyingContract,
      chainId: BADGE_DOMAIN.chainId,
      version: "v2",
      schema: badgeSchema("ContextShare"),
      fieldsValues: [],
    });
    if (context.type !== "success") throw new Error("expected success");
    const filter = context.filters.recipient;
    expect(filter?.type).toBe("trusted-name");
    expect(context.messageInfo.filtersCount).toBe(Object.keys(context.filters).length);
    if (filter?.type !== "trusted-name") return;
    expect(filter.typesAndSourcesPayload).toBe("0101020102");
    const binding = {
      chainId: BADGE_DOMAIN.chainId,
      verifyingContract: BADGE_DOMAIN.verifyingContract,
      schemaHash: badgeSchemaHash("ContextShare"),
    };
    const payload = contactFilterPayload(binding, field);
    expect(payload[0]).toBe(44);
    expect(
      verify("sha256", payload, { key: publicKey, dsaEncoding: "der" }, Buffer.from(filter.signature, "hex")),
    ).toBe(true);
  });

  it("refuses a contact field that is not a hidden address field", () => {
    expect(
      () => new BadgeClearSignLoader(signer, { ContextShare: { path: "taskLabel", label: "x" } }),
    ).toThrow(ClearSignSetupError);
  });
});
