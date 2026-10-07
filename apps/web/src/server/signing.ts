/**
 * Real device signing (also in mock mode): the message is clear-signed on the employee's Speculos, then verified
 * against the DIRECTORY address before it goes anywhere. The Ledger package already checks the signature against
 * the device's own address; this second check catches a device wired to the wrong employee (e.g. ports swapped).
 */
import {
  verifyBadgeSignature,
  type BadgeMessageKind,
  type BadgeMessages,
  type SignedMessage,
} from "@badge/consent";
import { isAddressEqual, recoverMessageAddress, type Hex } from "viem";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { withSigner } from "./devices";
import { EnclaveError } from "./errors";

/**
 * Clear-signs `message` on `employee`'s device (blocks until the user holds "Hold to sign" or rejects).
 * @throws UserRejectedError when refused on the device; ConsentError when the signature does not verify.
 */
export async function signOnDevice<K extends BadgeMessageKind>(
  employee: EmployeeId,
  kind: K,
  message: BadgeMessages[K],
): Promise<SignedMessage<K>> {
  const signature = await withSigner(employee, (signer) => signer.signBadgeMessage(kind, message));
  await verifyBadgeSignature(kind, message, signature, EMPLOYEES[employee].address);
  return { kind, message, signature };
}

/**
 * Signs an EIP-191 personal message (e.g. `deskIdentityDeriveMessage`) and checks it recovers the directory address.
 */
export async function signPersonalOnDevice(employee: EmployeeId, text: string): Promise<Hex> {
  const signature = await withSigner(employee, (signer) => signer.signPersonalMessage(text));
  const recovered = await recoverMessageAddress({ message: text, signature });
  if (!isAddressEqual(recovered, EMPLOYEES[employee].address)) {
    throw new EnclaveError(
      "SIGNATURE_REJECTED",
      `the device signed as ${recovered}, not as ${EMPLOYEES[employee].name}: check the Speculos port mapping`,
    );
  }
  return signature;
}
