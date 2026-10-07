/**
 * JSON wire format of Badge messages (web app <-> API <-> enclave). JSON has no bigint, so uint64/uint256 travel as
 * decimal strings; everything else keeps its natural JSON type. Decoding is strict: unknown keys, out-of-range
 * integers, malformed hex and non-canonical displayed strings are all rejected before any signature check.
 */
import { isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { isDeviceAscii } from "./ascii";
import { InvalidMessageError } from "./errors";
import type { BadgeMessageKind, BadgeMessages } from "./messages";

const UINT32_MAX = 2 ** 32 - 1;
const UINT64_MAX = 2n ** 64n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;
/** Bounds request size; the device pages long strings, but nothing legitimate in Badge comes close to this. */
export const MAX_WIRE_STRING_LENGTH = 256;
const DECIMAL_UINT = /^(0|[1-9][0-9]*)$/;
const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/;
/** r (32) || s (32) || v (1): the only signature shape the Ledger Ethereum app produces. */
const SIGNATURE_HEX = /^0x[0-9a-fA-F]{130}$/;

/** Signed strings must be non-empty canonical device ASCII, so what the owner saw is exactly what was signed. */
const deviceString = z
  .string()
  .min(1)
  .max(MAX_WIRE_STRING_LENGTH)
  .refine(isDeviceAscii, { error: "must be canonical device ASCII (see toDeviceAscii)" });

const uint32 = z.number().int().min(0).max(UINT32_MAX);

function decimalUint(max: bigint) {
  return z.codec(
    z.string().regex(DECIMAL_UINT, { error: "must be a decimal integer string" }),
    z.bigint().min(0n).max(max),
    {
      decode: (decimal) => BigInt(decimal),
      encode: (value) => value.toString(10),
    },
  );
}
const uint64 = decimalUint(UINT64_MAX);
const uint256 = decimalUint(UINT256_MAX);

const bytes32 = z.custom<Hex>((value) => typeof value === "string" && BYTES32_HEX.test(value), {
  error: "must be 0x-prefixed 32-byte hex",
});
/** Lower-case or checksummed; a mixed-case address with a wrong checksum is rejected as a probable typo. */
const address = z.custom<Address>((value) => typeof value === "string" && isAddress(value), {
  error: "must be an EVM address",
});
/** 65-byte hex signature (r, s, v). */
export const signatureSchema = z.custom<Hex>(
  (value) => typeof value === "string" && SIGNATURE_HEX.test(value),
  {
    error: "must be a 65-byte 0x-prefixed hex signature",
  },
);

/**
 * One strict zod schema per message kind. Keys must match `BADGE_TYPES` exactly (enforced by the wire tests) and
 * the decoded type must equal the message interface (enforced at compile time below).
 */
export const BADGE_WIRE_SCHEMAS = {
  EmployeeEnroll: z.strictObject({
    company: deviceString,
    employeeName: deviceString,
    team: deviceString,
    enclaveMeasurement: bytes32,
    employee: address,
    issuedAt: uint64,
    nonce: uint256,
  }),
  AgentSession: z.strictObject({
    agentName: deviceString,
    access: deviceString,
    expiresAt: uint64,
    sessionKey: address,
    enclaveMeasurement: bytes32,
    employee: address,
    nonce: uint256,
  }),
  ContextShare: z.strictObject({
    recipientName: deviceString,
    excerptLabel: deviceString,
    excerptLength: uint32,
    taskLabel: deviceString,
    expiresAt: uint64,
    excerptHash: bytes32,
    enclaveMeasurement: bytes32,
    recipient: address,
    owner: address,
    taskId: bytes32,
    nonce: uint256,
  }),
  ContextPolicy: z.strictObject({
    granteeTeam: deviceString,
    contextTag: deviceString,
    purpose: deviceString,
    maxExcerptLength: uint32,
    expiresAt: uint64,
    enclaveMeasurement: bytes32,
    owner: address,
    nonce: uint256,
  }),
  ContextRevoke: z.strictObject({
    targetLabel: deviceString,
    issuedAt: uint64,
    grantId: bytes32,
    recipient: address,
    owner: address,
    nonce: uint256,
  }),
  DeskJoin: z.strictObject({
    deskName: deviceString,
    company: deviceString,
    identityCommitment: uint256,
    employee: address,
    nonce: uint256,
  }),
  DeskShare: z.strictObject({
    recipientDesk: deviceString,
    excerptLabel: deviceString,
    excerptLength: uint32,
    ruleLabel: deviceString,
    expiresAt: uint64,
    excerptHash: bytes32,
    enclaveMeasurement: bytes32,
    sourceDesk: deviceString,
    requestId: bytes32,
    nonce: uint256,
  }),
} as const;

type WireSchemas = typeof BADGE_WIRE_SCHEMAS;

/** JSON shape of a message of kind K (bigints as decimal strings). */
export type WireMessage<K extends BadgeMessageKind> = z.input<WireSchemas[K]>;

// Compile-time guard: each schema decodes to exactly the shared message interface (both directions).
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemasMatchInterfaces: { [K in BadgeMessageKind]: Exact<z.output<WireSchemas[K]>, BadgeMessages[K]> } =
  {
    EmployeeEnroll: true,
    AgentSession: true,
    ContextShare: true,
    ContextPolicy: true,
    ContextRevoke: true,
    DeskJoin: true,
    DeskShare: true,
  };
void schemasMatchInterfaces;

/** All message kinds, in a stable order (handy for iteration and for zod enums). */
export const BADGE_MESSAGE_KINDS = Object.keys(BADGE_WIRE_SCHEMAS) as BadgeMessageKind[];

/** A Badge message with the signature that authorizes it. */
export interface SignedMessage<K extends BadgeMessageKind> {
  kind: K;
  message: BadgeMessages[K];
  signature: Hex;
}

/** Any signed Badge message, discriminated on `kind` (narrow with `if (signed.kind === "ContextShare")`). */
export type AnySignedMessage = { [K in BadgeMessageKind]: SignedMessage<K> }[BadgeMessageKind];

/** JSON shape of a {@link SignedMessage}. */
export interface WireSignedMessage<K extends BadgeMessageKind> {
  kind: K;
  message: WireMessage<K>;
  signature: Hex;
}

function signedSchema<K extends BadgeMessageKind>(kind: K) {
  return z.strictObject({
    kind: z.literal(kind),
    message: BADGE_WIRE_SCHEMAS[kind],
    signature: signatureSchema,
  });
}

const signedMessageSchema = z.discriminatedUnion("kind", [
  signedSchema("EmployeeEnroll"),
  signedSchema("AgentSession"),
  signedSchema("ContextShare"),
  signedSchema("ContextPolicy"),
  signedSchema("ContextRevoke"),
  signedSchema("DeskJoin"),
  signedSchema("DeskShare"),
]);

function invalid(context: string, error: z.ZodError): InvalidMessageError {
  return new InvalidMessageError(`${context}: ${z.prettifyError(error)}`, { cause: error });
}

/** Serializes a message to its JSON wire shape. Throws {@link InvalidMessageError} if the message is out of range. */
export function encodeBadgeMessage<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
): WireMessage<K> {
  const result = z.safeEncode(BADGE_WIRE_SCHEMAS[kind] as z.ZodType, message);
  if (!result.success) throw invalid(`cannot encode ${kind}`, result.error);
  // Safe: the schema for K encodes BadgeMessages[K] to WireMessage<K> (checked by schemasMatchInterfaces).
  return result.data as WireMessage<K>;
}

/** Parses an untrusted JSON value as a message of `kind`. Throws {@link InvalidMessageError} on any deviation. */
export function decodeBadgeMessage<K extends BadgeMessageKind>(kind: K, json: unknown): BadgeMessages[K] {
  // safeParse (not safeDecode): the input is untrusted `unknown`; parsing runs the codecs in the decode direction.
  const result = BADGE_WIRE_SCHEMAS[kind].safeParse(json);
  if (!result.success) throw invalid(`invalid ${kind}`, result.error);
  return result.data as BadgeMessages[K];
}

/** Serializes a signed message to its JSON wire shape. */
export function encodeSignedMessage<K extends BadgeMessageKind>(
  signed: SignedMessage<K>,
): WireSignedMessage<K> {
  const result = z.safeEncode(signedMessageSchema as z.ZodType, signed);
  if (!result.success) throw invalid(`cannot encode signed ${signed.kind}`, result.error);
  return result.data as WireSignedMessage<K>;
}

/**
 * Parses an untrusted signed message. With `expectedKind`, any other kind is rejected (an endpoint that accepts
 * shares must not be fed a policy). Does NOT verify the signature: call `verifyBadgeSignature` next.
 */
export function decodeSignedMessage<K extends BadgeMessageKind>(
  json: unknown,
  expectedKind: K,
): SignedMessage<K>;
export function decodeSignedMessage(json: unknown): AnySignedMessage;
export function decodeSignedMessage(json: unknown, expectedKind?: BadgeMessageKind): AnySignedMessage {
  const result = signedMessageSchema.safeParse(json);
  if (!result.success) throw invalid("invalid signed message", result.error);
  if (expectedKind !== undefined && result.data.kind !== expectedKind) {
    throw new InvalidMessageError(`expected a signed ${expectedKind}, got ${result.data.kind}`);
  }
  return result.data;
}
