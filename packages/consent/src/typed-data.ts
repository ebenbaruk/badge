/**
 * Builds the EIP-712 payloads that the Ledger signs and the enclave verifies, from the shared definitions.
 */
import { hashTypedData, type Hex, type TypedDataDefinition } from "viem";
import {
  BADGE_DOMAIN,
  BADGE_TYPES,
  EIP712_DOMAIN_TYPE,
  type BadgeMessageKind,
  type BadgeMessages,
} from "./messages";

/** The `types` object of one Badge message kind: its own struct plus `EIP712Domain`. */
export type BadgeTypes<K extends BadgeMessageKind> = { EIP712Domain: typeof EIP712_DOMAIN_TYPE } & {
  [P in K]: (typeof BADGE_TYPES)[P];
};

/** A complete EIP-712 payload for one Badge message, compatible with viem and the Ledger DMK. */
export type BadgeTypedData<K extends BadgeMessageKind> = TypedDataDefinition<BadgeTypes<K>, K> & {
  domain: typeof BADGE_DOMAIN;
};

/**
 * Returns the EIP-712 payload for `message`.
 *
 * `types` lists `EIP712Domain` explicitly because the Ledger DMK sends the domain struct definition to the device
 * from `types` (viem would infer it, the DMK does not). It only contains the primary struct: sending unrelated
 * structs to the device costs APDUs and does not change the hash.
 */
export function badgeTypedData<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
): BadgeTypedData<K> {
  // The mapped type cannot be built generically without a cast; the shape is checked by the typed-data tests.
  const types = { EIP712Domain: EIP712_DOMAIN_TYPE, [kind]: BADGE_TYPES[kind] } as BadgeTypes<K>;
  return { domain: BADGE_DOMAIN, types, primaryType: kind, message } as unknown as BadgeTypedData<K>;
}

/**
 * EIP-712 digest of `message` (what the device signs). Used as the grant id of shares and policies, which is what
 * a `ContextRevoke.grantId` points to.
 */
export function hashBadgeMessage<K extends BadgeMessageKind>(kind: K, message: BadgeMessages[K]): Hex {
  // viem's generic signature cannot relate a generic K to its message type; the payload is built just above.
  return hashTypedData(badgeTypedData(kind, message) as unknown as TypedDataDefinition);
}
