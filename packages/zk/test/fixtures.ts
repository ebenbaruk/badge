import { deskIdentityDeriveMessage } from "@badge/consent";
import { type Hex, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const COMPANY = "Acme";

/**
 * Stand-in for the Ledger: a local account signing the same EIP-191 message. Like a Ledger, viem signs with RFC 6979
 * deterministic nonces, so the signature (hence the identity) is stable.
 */
export function ledgerSignatureOf(name: string): Promise<Hex> {
  const account = privateKeyToAccount(keccak256(stringToHex(`badge-test-key:${name}`)));
  return account.signMessage({ message: deskIdentityDeriveMessage(COMPANY) });
}

export const EXCERPT_HASH: Hex = keccak256(
  stringToHex("Conditions Orion 2025 : remise 12 %, paiement 60 j."),
);
export const OTHER_EXCERPT_HASH: Hex = keccak256(stringToHex("Another excerpt"));
export const REQUEST_ID: Hex = keccak256(stringToHex("req-42"));
export const OTHER_REQUEST_ID: Hex = keccak256(stringToHex("req-43"));
