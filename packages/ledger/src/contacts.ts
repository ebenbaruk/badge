/**
 * Device address book ("Contacts", app-ethereum >= 1.23): the device itself certifies a contact name with HMAC
 * proofs, so an address field of an EIP-712 message can be displayed as "Alice (Ventes)" instead of 0x...
 *
 * Unlike the signed `recipientName` string (which the host chooses), a contact name was confirmed by the owner on
 * the device when registered, so a compromised host cannot relabel an address. The kit is stateless: the host
 * stores the proofs ({@link ContactProof}) and provides the matching contact before each signature.
 *
 * The DMK (signer-eth 1.18.1) only wires the address book for the `to` of transactions, so for EIP-712 we send the
 * PROVIDE CONTACT APDU ourselves and add a `trusted-name` filter on the address field (see clearSign.ts).
 */
import { buildProvideContactPayload } from "@ledgerhq/device-contacts-kit";
import { bytesToHex, getAddress, hexToBytes, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { BadgeMessageKind } from "@badge/consent";

/** An address field rendered through the device address book, and its label. */
export interface ContactField {
  path: string;
  label: string;
}

/**
 * Address fields we suggest to render with contact names. Opt-in (see `LedgerSignerOptions.contactFields`): the
 * field is then displayed as one more review line, as the raw address when no contact matches.
 */
export const SUGGESTED_CONTACT_FIELDS: Partial<Record<BadgeMessageKind, ContactField>> = {
  ContextShare: { path: "recipient", label: "Destinataire" },
  ContextRevoke: { path: "recipient", label: "Destinataire" },
};

const GROUP_HANDLE_BYTES = 64;
const HMAC_BYTES = 32;
const hexOfLength = (bytes: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`))
    .transform((value) => value as Hex);

/** Proof material returned by the device when a contact is registered; persisted by the host. */
export const ContactProofSchema = z.object({
  contactName: z
    .string()
    .regex(/^[\x20-\x7E]+$/, "contact names are shown on the device: printable ASCII only"),
  scope: z.string().regex(/^[\x20-\x7E]+$/),
  address: z
    .string()
    .refine((value) => isAddress(value), "not an address")
    .transform((value) => getAddress(value)),
  chainId: z.number().int().positive(),
  groupHandle: hexOfLength(GROUP_HANDLE_BYTES),
  hmacProof: hexOfLength(HMAC_BYTES),
  hmacRest: hexOfLength(HMAC_BYTES),
});

export type ContactProof = z.infer<typeof ContactProofSchema>;

/** Converts the raw bytes returned by `registerExternalAddress` into a storable proof. */
export function toContactProof(args: {
  contactName: string;
  scope: string;
  address: Address;
  chainId: number;
  groupHandle: Uint8Array;
  hmacProof: Uint8Array;
  hmacRest: Uint8Array;
}): ContactProof {
  return ContactProofSchema.parse({
    ...args,
    groupHandle: bytesToHex(args.groupHandle),
    hmacProof: bytesToHex(args.hmacProof),
    hmacRest: bytesToHex(args.hmacRest),
  });
}

/** APDU header of PROVIDE CONTACT (an OS-level command, hence not the Ethereum app CLA 0xE0). */
const PROVIDE_CONTACT = { cla: 0xb0, ins: 0x10, p1: 0x20 } as const;
const P2_FIRST_CHUNK = 0x00;
const P2_NEXT_CHUNK = 0x80;
const MAX_APDU_DATA_BYTES = 255;
const LENGTH_PREFIX_BYTES = 2;
const BLOCKCHAIN_FAMILY = "ethereum";

/**
 * APDUs that provide `proof` to the device, framed like device-contacts-kit does internally: the TLV payload is
 * prefixed with its 2-byte length, then split in 255-byte chunks (P2 = 0x00 first, 0x80 next).
 */
export function provideContactApdus(proof: ContactProof): Uint8Array[] {
  const payload = buildProvideContactPayload({
    contactName: proof.contactName,
    scope: proof.scope,
    identifier: hexToBytes(proof.address),
    blockchainFamily: BLOCKCHAIN_FAMILY,
    chainId: BigInt(proof.chainId),
    groupHandle: hexToBytes(proof.groupHandle),
    hmacProof: hexToBytes(proof.hmacProof),
    hmacRest: hexToBytes(proof.hmacRest),
  });
  const framed = new Uint8Array(payload.length + LENGTH_PREFIX_BYTES);
  new DataView(framed.buffer).setUint16(0, payload.length);
  framed.set(payload, LENGTH_PREFIX_BYTES);

  const apdus: Uint8Array[] = [];
  for (let offset = 0; offset < framed.length; offset += MAX_APDU_DATA_BYTES) {
    const chunk = framed.subarray(offset, offset + MAX_APDU_DATA_BYTES);
    const p2 = offset === 0 ? P2_FIRST_CHUNK : P2_NEXT_CHUNK;
    apdus.push(
      Uint8Array.from([
        PROVIDE_CONTACT.cla,
        PROVIDE_CONTACT.ins,
        PROVIDE_CONTACT.p1,
        p2,
        chunk.length,
        ...chunk,
      ]),
    );
  }
  return apdus;
}
