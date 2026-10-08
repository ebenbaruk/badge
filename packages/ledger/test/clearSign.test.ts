import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TypedDataContext, TypedDataClearSignContextSuccess } from "@ledgerhq/context-module";
import { DeviceModelId } from "@ledgerhq/device-management-kit";
import { BADGE_DESCRIPTORS, BADGE_DOMAIN, BADGE_TYPES, type BadgeMessageKind } from "@badge/consent";
import { describe, expect, it } from "vitest";
import {
  BadgeClearSignLoader,
  badgeSchema,
  badgeSchemaHash,
  compileClearSignContext,
  fieldFilterPayload,
  loadCalTestSigner,
  messageInfoPayload,
  type FilterSigner,
} from "../src/clearSign";
import { ClearSignSetupError } from "../src/errors";

/**
 * Expected payloads for ContextShare, derived with the algorithm of the original R2 prototype (validated on a
 * Speculos Flex): magic || chainId u64 BE || verifyingContract || SHA-224 schema hash || data.
 */
const CONTEXT_SHARE_FIXTURE = {
  schemaHash: "8686e0671f7c02cf3815b418ab36390a3fcd1fff642372fdc09f21c9",
  messageInfo:
    "b70000000000000001000000000000000000000000000000000000bad98686e0671f7c02cf3815b418ab36390a3fcd1fff642372fdc0" +
    "9f21c907536861726520616e2065786365727074",
  rawRecipientName:
    "480000000000000001000000000000000000000000000000000000bad98686e0671f7c02cf3815b418ab36390a3fcd1fff642372fdc0" +
    "9f21c9726563697069656e744e616d6553686172652077697468",
  datetimeExpiresAt:
    "210000000000000001000000000000000000000000000000000000bad98686e0671f7c02cf3815b418ab36390a3fcd1fff642372fdc0" +
    "9f21c965787069726573417445787069726573",
};

const KINDS = Object.keys(BADGE_TYPES) as BadgeMessageKind[];

function testKey(): { signer: FilterSigner; publicKey: KeyObject; pemPath: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const pem = privateKey.export({ format: "pem", type: "sec1" }).toString();
  const dir = mkdtempSync(join(tmpdir(), "badge-cal-"));
  const pemPath = join(dir, "cal.pem");
  // Same layout as app-ethereum's cal.pem: an EC PARAMETERS block precedes the key.
  writeFileSync(pemPath, `-----BEGIN EC PARAMETERS-----\nBgUrgQQACg==\n-----END EC PARAMETERS-----\n${pem}`);
  return { signer: loadCalTestSigner(pemPath), publicKey, pemPath };
}

function contextFor(kind: BadgeMessageKind, overrides: Partial<TypedDataContext> = {}): TypedDataContext {
  return {
    deviceModelId: DeviceModelId.FLEX,
    verifyingContract: BADGE_DOMAIN.verifyingContract,
    chainId: BADGE_DOMAIN.chainId,
    version: "v2",
    schema: badgeSchema(kind),
    fieldsValues: [],
    ...overrides,
  };
}

const binding = {
  chainId: BADGE_DOMAIN.chainId,
  verifyingContract: BADGE_DOMAIN.verifyingContract,
  schemaHash: CONTEXT_SHARE_FIXTURE.schemaHash,
};

describe("schema hash", () => {
  it("matches the prototype fixture for ContextShare", () => {
    expect(badgeSchemaHash("ContextShare")).toBe(CONTEXT_SHARE_FIXTURE.schemaHash);
  });

  it("is distinct for every Badge message kind", () => {
    expect(new Set(KINDS.map(badgeSchemaHash)).size).toBe(KINDS.length);
  });
});

describe("filter payloads", () => {
  it("encodes the message info byte for byte", () => {
    expect(messageInfoPayload(binding, "Share an excerpt", 7).toString("hex")).toBe(
      CONTEXT_SHARE_FIXTURE.messageInfo,
    );
  });

  it("encodes raw and datetime field filters byte for byte", () => {
    const raw = fieldFilterPayload(binding, { path: "recipientName", label: "Share with", format: "raw" });
    const datetime = fieldFilterPayload(binding, {
      path: "expiresAt",
      label: "Expires",
      format: "datetime",
    });
    expect(raw.toString("hex")).toBe(CONTEXT_SHARE_FIXTURE.rawRecipientName);
    expect(datetime.toString("hex")).toBe(CONTEXT_SHARE_FIXTURE.datetimeExpiresAt);
  });

  it("rejects a malformed binding or filters count", () => {
    expect(() => messageInfoPayload({ ...binding, schemaHash: "00" }, "x", 1)).toThrow(ClearSignSetupError);
    expect(() => messageInfoPayload({ ...binding, verifyingContract: "0x12" }, "x", 1)).toThrow(
      ClearSignSetupError,
    );
    expect(() => messageInfoPayload(binding, "x", 256)).toThrow(ClearSignSetupError);
  });
});

describe("compileClearSignContext", () => {
  it("signs every filter with the CAL key and attaches the COIN_META certificate", () => {
    const { signer, publicKey } = testKey();
    const descriptor = BADGE_DESCRIPTORS.ContextShare;
    const context = compileClearSignContext(descriptor, binding, signer) as TypedDataClearSignContextSuccess;

    expect(context.type).toBe("success");
    expect(context.messageInfo.filtersCount).toBe(descriptor.fields.length);
    expect(context.certificate?.keyUsageNumber).toBe(0x08);
    const verifies = (payload: Buffer, signature: string): boolean =>
      verify("sha256", payload, { key: publicKey, dsaEncoding: "der" }, Buffer.from(signature, "hex"));
    expect(
      verifies(
        messageInfoPayload(binding, descriptor.intent, descriptor.fields.length),
        context.messageInfo.signature,
      ),
    ).toBe(true);
    for (const field of descriptor.fields) {
      const filter = context.filters[field.path];
      expect(filter).toMatchObject({ type: field.format, displayName: field.label, path: field.path });
      expect(verifies(fieldFilterPayload(binding, field), filter?.signature ?? "")).toBe(true);
    }
  });

  it("refuses non-ASCII labels (the device would garble them)", () => {
    const { signer } = testKey();
    const descriptor = {
      intent: "Share",
      fields: [{ path: "a", label: "Task →", format: "raw" as const }],
    };
    expect(() => compileClearSignContext(descriptor, binding, signer)).toThrow(ClearSignSetupError);
  });
});

describe("BadgeClearSignLoader", () => {
  const { signer } = testKey();
  const loader = new BadgeClearSignLoader(signer);

  it.each(KINDS)("serves the %s descriptor", async (kind) => {
    const context = await loader.load(contextFor(kind));
    expect(context.type).toBe("success");
    if (context.type !== "success") return;
    expect(context.messageInfo.displayName).toBe(BADGE_DESCRIPTORS[kind].intent);
    expect(Object.keys(context.filters)).toEqual(BADGE_DESCRIPTORS[kind].fields.map((field) => field.path));
  });

  it("fails closed on a foreign schema, chain or verifying contract", async () => {
    const foreignSchema = { ...badgeSchema("ContextShare"), Extra: [{ name: "x", type: "uint256" }] };
    const cases: Partial<TypedDataContext>[] = [
      { schema: foreignSchema },
      { chainId: 137 },
      { verifyingContract: "0x000000000000000000000000000000000000dead" },
    ];
    for (const overrides of cases) {
      const context = await loader.load(contextFor("ContextShare", overrides));
      expect(context.type).toBe("error");
    }
  });
});

describe("loadCalTestSigner", () => {
  it("reports a missing key with the setup hint", () => {
    expect(() => loadCalTestSigner("/nonexistent/cal.pem")).toThrow(/infra\/setup\.sh|BADGE_CAL_TEST_KEY/);
  });

  it("refuses a file without an EC private key", () => {
    const dir = mkdtempSync(join(tmpdir(), "badge-cal-"));
    const pemPath = join(dir, "empty.pem");
    writeFileSync(pemPath, "not a key");
    expect(() => loadCalTestSigner(pemPath)).toThrow(ClearSignSetupError);
  });
});
