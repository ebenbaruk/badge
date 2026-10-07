/**
 * Adapters between the shared Badge EIP-712 payload (`@badge/consent`) and the shapes the DMK and viem expect.
 */
import type { TypedData as DmkTypedData } from "@ledgerhq/device-signer-kit-ethereum";
import type { TypedDataDefinition } from "viem";
import {
  BADGE_TYPES,
  badgeTypedData,
  isDeviceAscii,
  type BadgeMessageKind,
  type BadgeMessages,
  type BadgeTypedData,
} from "@badge/consent";
import { NonAsciiFieldError } from "./errors";

export { badgeTypedData };
export type BadgeTypedDataPayload<K extends BadgeMessageKind> = BadgeTypedData<K>;

/** Same payload typed for viem's `recoverTypedDataAddress` / `hashTypedData`. */
export function toViemTypedData<K extends BadgeMessageKind>(payload: BadgeTypedData<K>): TypedDataDefinition {
  // viem cannot relate a generic K to its message type; the payload structure is the EIP-712 one.
  return payload as unknown as TypedDataDefinition;
}

/** Same payload in the DMK shape (mutable field arrays, untyped message). */
export function toDmkTypedData<K extends BadgeMessageKind>(payload: BadgeTypedData<K>): DmkTypedData {
  const types: DmkTypedData["types"] = {};
  for (const [struct, fields] of Object.entries(
    payload.types as Record<string, readonly { name: string; type: string }[]>,
  )) {
    types[struct] = fields.map(({ name, type }) => ({ name, type }));
  }
  const message: Record<string, unknown> = { ...(payload.message as Record<string, unknown>) };
  return { domain: { ...payload.domain }, types, primaryType: payload.primaryType as string, message };
}

/**
 * Rejects any string field that is not device ASCII. The device renders non-ASCII bytes as garbage, so the user
 * would approve a value different from the one signed: fail closed rather than sign it.
 * @throws NonAsciiFieldError
 */
export function assertStringFieldsAscii<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
): void {
  for (const field of BADGE_TYPES[kind]) {
    if (field.type !== "string") continue;
    const value: unknown = (message as unknown as Record<string, unknown>)[field.name];
    if (typeof value === "string" && !isDeviceAscii(value)) {
      throw new NonAsciiFieldError(`${kind}.${field.name}`);
    }
  }
}
