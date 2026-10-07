import { zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  BADGE_TYPES,
  checkAgentSession,
  checkContextPolicy,
  checkContextRevoke,
  checkContextShare,
  checkDeskJoin,
  checkDeskShare,
  checkEmployeeEnroll,
  claimedSigner,
  ConsentError,
  MalformedSignatureError,
  MAX_ENROLL_AGE_SECONDS,
  MAX_POLICY_TTL_SECONDS,
  MAX_SHARE_TTL_SECONDS,
  SignatureMismatchError,
  SNARK_SCALAR_FIELD,
  toUnixSeconds,
  verifyBadgeSignature,
  type BadgeMessageKind,
  type BadgeMessages,
  type ConsentErrorCode,
} from "../src";
import { agentKey, alice, bob, EXCERPT, HOUR, KINDS, MEASUREMENT, MESSAGES, NOW, signAs } from "./fixtures";

const OTHER_MEASUREMENT: Hex = `0x${"cd".repeat(32)}`;

/** Returns a copy of `value` changed in a way that is still well-typed for its EIP-712 type. */
function tamper(type: string, value: unknown): unknown {
  switch (type) {
    case "string":
      return `${String(value)}x`;
    case "address":
      return value === bob.address ? agentKey.address : bob.address;
    case "bytes32":
      return `${(value as string).slice(0, -2)}${(value as string).endsWith("00") ? "01" : "00"}`;
    case "uint32":
      return (value as number) + 1;
    default:
      return (value as bigint) + 1n;
  }
}

function expectCode(run: () => void, code: ConsentErrorCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConsentError);
    expect((error as ConsentError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected ${code}`);
}

describe("verifyBadgeSignature", () => {
  it.each(KINDS)("%s: accepts the signer's signature", async (kind) => {
    const signature = await signAs(alice, kind, MESSAGES[kind]);
    await expect(
      verifyBadgeSignature(kind, MESSAGES[kind], signature, alice.address),
    ).resolves.toBeUndefined();
  });

  it.each(KINDS)("%s: rejects another signer", async (kind) => {
    const signature = await signAs(bob, kind, MESSAGES[kind]);
    await expect(verifyBadgeSignature(kind, MESSAGES[kind], signature, alice.address)).rejects.toBeInstanceOf(
      SignatureMismatchError,
    );
  });

  const fieldCases = KINDS.flatMap((kind) =>
    BADGE_TYPES[kind].map(({ name, type }) => [kind, name, type] as const),
  );
  it.each(fieldCases)("%s: tampering with %s (%s) breaks the signature", async (kind, name, type) => {
    const message = MESSAGES[kind];
    const signature = await signAs(alice, kind, message);
    const tampered = {
      ...message,
      [name]: tamper(type, (message as unknown as Record<string, unknown>)[name]),
    };
    await expect(
      verifyBadgeSignature(kind, tampered as BadgeMessages[typeof kind], signature, alice.address),
    ).rejects.toBeInstanceOf(SignatureMismatchError);
  });

  it("rejects a signature for another kind with the same signer", async () => {
    const signature = await signAs(alice, "ContextPolicy", MESSAGES.ContextPolicy);
    await expect(
      verifyBadgeSignature("ContextShare", MESSAGES.ContextShare, signature, alice.address),
    ).rejects.toBeInstanceOf(SignatureMismatchError);
  });

  it("rejects malformed signatures", async () => {
    const garbage: Hex = `0x${"00".repeat(65)}`;
    await expect(
      verifyBadgeSignature("ContextShare", MESSAGES.ContextShare, garbage, alice.address),
    ).rejects.toBeInstanceOf(MalformedSignatureError);
  });

  it("never accepts the zero address as signer", async () => {
    const signature = await signAs(alice, "ContextShare", MESSAGES.ContextShare);
    await expect(
      verifyBadgeSignature("ContextShare", MESSAGES.ContextShare, signature, zeroAddress),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
  });
});

describe("claimedSigner", () => {
  it.each<[BadgeMessageKind, Address | null]>([
    ["EmployeeEnroll", alice.address],
    ["AgentSession", alice.address],
    ["ContextShare", alice.address],
    ["ContextPolicy", alice.address],
    ["ContextRevoke", alice.address],
    ["DeskJoin", alice.address],
    ["DeskShare", null],
  ])("%s -> %s", (kind, expected) => {
    expect(claimedSigner(kind, MESSAGES[kind])).toBe(expected);
  });
});

describe("checkContextShare", () => {
  const share = MESSAGES.ContextShare;
  const context = { now: NOW, enclaveMeasurement: MEASUREMENT, excerptText: EXCERPT };

  it("accepts a valid share", () => {
    expect(() => checkContextShare(share, context)).not.toThrow();
  });

  it("accepts an upper-case measurement", () => {
    expect(() =>
      checkContextShare(share, {
        ...context,
        enclaveMeasurement: MEASUREMENT.toUpperCase().replace("0X", "0x") as Hex,
      }),
    ).not.toThrow();
  });

  it.each<[string, Partial<typeof context>, Partial<typeof share>, ConsentErrorCode]>([
    ["expired", { now: share.expiresAt }, {}, "EXPIRED"],
    ["too long horizon", {}, { expiresAt: NOW + MAX_SHARE_TTL_SECONDS + 1n }, "TTL_TOO_LONG"],
    ["other enclave", { enclaveMeasurement: OTHER_MEASUREMENT }, {}, "ENCLAVE_MISMATCH"],
    ["other text", { excerptText: `${EXCERPT}!` }, {}, "EXCERPT_HASH_MISMATCH"],
    ["wrong length", {}, { excerptLength: share.excerptLength + 1 }, "EXCERPT_LENGTH_MISMATCH"],
    ["non-ASCII label", {}, { recipientName: "Bob (Équipe)" }, "NOT_DEVICE_ASCII"],
    ["zero recipient", {}, { recipient: zeroAddress }, "INVALID_FIELD"],
  ])("rejects: %s", (_name, contextPatch, sharePatch, code) => {
    expectCode(() => checkContextShare({ ...share, ...sharePatch }, { ...context, ...contextPatch }), code);
  });
});

describe("checkAgentSession", () => {
  const session = MESSAGES.AgentSession;
  const context = { now: NOW, enclaveMeasurement: MEASUREMENT };

  it("accepts a valid session", () => {
    expect(() => checkAgentSession(session, context)).not.toThrow();
  });

  it.each<[string, Partial<typeof context>, Partial<typeof session>, ConsentErrorCode]>([
    ["expired", { now: session.expiresAt + 1n }, {}, "EXPIRED"],
    ["too long", {}, { expiresAt: NOW + 30n * 24n * HOUR }, "TTL_TOO_LONG"],
    ["other enclave", { enclaveMeasurement: OTHER_MEASUREMENT }, {}, "ENCLAVE_MISMATCH"],
    ["self delegation", {}, { sessionKey: alice.address }, "INVALID_FIELD"],
  ])("rejects: %s", (_name, contextPatch, patch, code) => {
    expectCode(() => checkAgentSession({ ...session, ...patch }, { ...context, ...contextPatch }), code);
  });
});

describe("checkContextPolicy", () => {
  const policy = MESSAGES.ContextPolicy;
  const context = { now: NOW, enclaveMeasurement: MEASUREMENT };

  it("accepts a valid policy, with or without an excerpt", () => {
    expect(() => checkContextPolicy(policy, context)).not.toThrow();
    expect(() => checkContextPolicy(policy, { ...context, excerptText: EXCERPT })).not.toThrow();
  });

  it.each<
    [string, Partial<typeof context> & { excerptText?: string }, Partial<typeof policy>, ConsentErrorCode]
  >([
    ["expired", { now: policy.expiresAt }, {}, "EXPIRED"],
    ["too long", {}, { expiresAt: NOW + MAX_POLICY_TTL_SECONDS + 1n }, "TTL_TOO_LONG"],
    ["other enclave", { enclaveMeasurement: OTHER_MEASUREMENT }, {}, "ENCLAVE_MISMATCH"],
    ["zero cap", {}, { maxExcerptLength: 0 }, "INVALID_FIELD"],
    ["excerpt over cap", { excerptText: "x".repeat(501) }, {}, "EXCERPT_TOO_LONG"],
  ])("rejects: %s", (_name, contextPatch, patch, code) => {
    expectCode(() => checkContextPolicy({ ...policy, ...patch }, { ...context, ...contextPatch }), code);
  });
});

describe("checkDeskShare", () => {
  const share = MESSAGES.DeskShare;
  const context = { now: NOW, enclaveMeasurement: MEASUREMENT, excerptText: EXCERPT };

  it("accepts a valid desk share", () => {
    expect(() => checkDeskShare(share, context)).not.toThrow();
  });

  it.each<[string, Partial<typeof context>, Partial<typeof share>, ConsentErrorCode]>([
    ["expired", { now: share.expiresAt }, {}, "EXPIRED"],
    ["other enclave", { enclaveMeasurement: OTHER_MEASUREMENT }, {}, "ENCLAVE_MISMATCH"],
    ["other text", { excerptText: "autre" }, {}, "EXCERPT_HASH_MISMATCH"],
    ["same desk", {}, { recipientDesk: share.sourceDesk }, "INVALID_FIELD"],
    ["non-ASCII hidden string", {}, { sourceDesk: "Fusions & acquisitions é" }, "NOT_DEVICE_ASCII"],
  ])("rejects: %s", (_name, contextPatch, patch, code) => {
    expectCode(() => checkDeskShare({ ...share, ...patch }, { ...context, ...contextPatch }), code);
  });
});

describe("checkEmployeeEnroll", () => {
  const enroll = MESSAGES.EmployeeEnroll;
  const context = { now: NOW, enclaveMeasurement: MEASUREMENT };

  it("accepts a fresh enrollment", () => {
    expect(() => checkEmployeeEnroll(enroll, context)).not.toThrow();
  });

  it.each<[string, Partial<typeof context>, Partial<typeof enroll>, ConsentErrorCode]>([
    ["stale", { now: enroll.issuedAt + MAX_ENROLL_AGE_SECONDS + 1n }, {}, "STALE"],
    ["future", {}, { issuedAt: NOW + HOUR }, "NOT_YET_VALID"],
    ["other enclave", { enclaveMeasurement: OTHER_MEASUREMENT }, {}, "ENCLAVE_MISMATCH"],
    ["zero employee", {}, { employee: zeroAddress }, "INVALID_FIELD"],
  ])("rejects: %s", (_name, contextPatch, patch, code) => {
    expectCode(() => checkEmployeeEnroll({ ...enroll, ...patch }, { ...context, ...contextPatch }), code);
  });
});

describe("checkContextRevoke and checkDeskJoin", () => {
  it("accepts valid messages", () => {
    expect(() => checkContextRevoke(MESSAGES.ContextRevoke, { now: NOW })).not.toThrow();
    expect(() => checkDeskJoin(MESSAGES.DeskJoin)).not.toThrow();
  });

  it("rejects a future revocation", () => {
    expectCode(
      () => checkContextRevoke({ ...MESSAGES.ContextRevoke, issuedAt: NOW + HOUR }, { now: NOW }),
      "NOT_YET_VALID",
    );
  });

  it.each([0n, SNARK_SCALAR_FIELD])("rejects commitment %s", (identityCommitment) => {
    expectCode(() => checkDeskJoin({ ...MESSAGES.DeskJoin, identityCommitment }), "INVALID_FIELD");
  });
});

describe("toUnixSeconds", () => {
  it("floors milliseconds", () => {
    expect(toUnixSeconds(new Date(1_700_000_000_999))).toBe(1_700_000_000n);
  });
});
