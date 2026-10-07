/**
 * EIP-712 payload of a Badge message, in the shape the DMK and viem both accept.
 *
 * Integration note: `@badge/consent` is gaining an equivalent `badgeTypedData` export; once it lands this module
 * should re-export it instead of building the payload here (same signature, same output).
 */
import type { TypedData as DmkTypedData } from "@ledgerhq/device-signer-kit-ethereum";
import type { TypedDataDefinition } from "viem";
import {
  BADGE_DOMAIN,
  BADGE_TYPES,
  EIP712_DOMAIN_TYPE,
  type BadgeMessageKind,
  type BadgeMessages,
} from "@badge/consent";
import { NonAsciiFieldError } from "./errors";

/** Plain EIP-712 payload; `types` lists `EIP712Domain` explicitly because the DMK sends it from `types`. */
export interface BadgeTypedDataPayload<K extends BadgeMessageKind> {
  domain: typeof BADGE_DOMAIN;
  types: { EIP712Domain: typeof EIP712_DOMAIN_TYPE } & { [P in K]: (typeof BADGE_TYPES)[P] };
  primaryType: K;
  message: BadgeMessages[K];
}

/** Builds the EIP-712 payload of one Badge message (only its own struct: unrelated structs cost APDUs). */
export function badgeTypedData<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
): BadgeTypedDataPayload<K> {
  // A mapped type keyed by a generic K cannot be built without a cast; the shape is covered by the tests.
  const types = {
    EIP712Domain: EIP712_DOMAIN_TYPE,
    [kind]: BADGE_TYPES[kind],
  } as BadgeTypedDataPayload<K>["types"];
  return { domain: BADGE_DOMAIN, types, primaryType: kind, message };
}

/** Same payload typed for viem's `recoverTypedDataAddress` / `hashTypedData`. */
export function toViemTypedData<K extends BadgeMessageKind>(
  payload: BadgeTypedDataPayload<K>,
): TypedDataDefinition {
  // viem cannot relate a generic K to its message type; the payload structure is the EIP-712 one.
  return payload as unknown as TypedDataDefinition;
}

/** Same payload in the DMK shape (mutable field arrays, untyped message). */
export function toDmkTypedData<K extends BadgeMessageKind>(payload: BadgeTypedDataPayload<K>): DmkTypedData {
  const types: DmkTypedData["types"] = {};
  for (const [struct, fields] of Object.entries(payload.types)) {
    types[struct] = fields.map(({ name, type }) => ({ name, type }));
  }
  const message: Record<string, unknown> = { ...payload.message };
  return { domain: { ...payload.domain }, types, primaryType: payload.primaryType, message };
}

const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

/**
 * Rejects any string field that is not printable ASCII. The device renders non-ASCII bytes as garbage, so the
 * user would approve a value different from the one signed: fail closed rather than sign it.
 * @throws NonAsciiFieldError
 */
export function assertStringFieldsAscii<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
): void {
  for (const field of BADGE_TYPES[kind]) {
    if (field.type !== "string") continue;
    const value: unknown = (message as unknown as Record<string, unknown>)[field.name];
    if (typeof value === "string" && !PRINTABLE_ASCII.test(value)) {
      throw new NonAsciiFieldError(`${kind}.${field.name}`);
    }
  }
}
