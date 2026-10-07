"use server";
/**
 * Compliance actions (role compliance only, enforced by the enclave). The officer's X25519 key is never stored: it
 * is re-derived from a personal-message signature on her Ledger (deterministic, RFC 6979) each time it is needed,
 * used in this device bridge, then wiped. The enclave only ever sees the public key and the reveal notice.
 */
import {
  complianceKeyDeriveMessage,
  complianceKeyFromSignature,
  complianceKeyRegistrationMessage,
  openSealed,
} from "@badge/attest";
import { revalidatePath } from "next/cache";
import { isAddressEqual } from "viem";
import { z } from "zod";
import { COMPANY_NAME, EMPLOYEES, EMPLOYEE_IDS, type EmployeeId } from "@/lib/directory";
import { enclave, type EnrollmentView, type SealedIdentityView } from "../enclave";
import { EnclaveError, runAction, type ActionResult } from "../errors";
import { signPersonalOnDevice } from "../signing";
import { employeeIdSchema } from "./schemas";

const DESK_SHARE = "desk.share";
/** Logged with every reveal: the demo has a single reason, a real deployment would ask for a case reference. */
const REVEAL_REASON = "Controle de conformite";

const employeeSchema = z.object({ employee: employeeIdSchema });
const revealSchema = z.object({ employee: employeeIdSchema, seq: z.number().int().positive() });

/** What the enclave seals for the officer in a `desk.share` entry (apps/enclave, SealedSignerIdentity). */
const sealedSignerSchema = z.object({
  employeeId: z.enum(EMPLOYEE_IDS),
  address: z.string(),
  requestId: z.string(),
});

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/** Derives the officer's key pair on her Ledger (one device review). The caller must wipe `secretKey`. */
async function deriveComplianceKey(employee: EmployeeId) {
  const signature = await signPersonalOnDevice(employee, complianceKeyDeriveMessage(COMPANY_NAME));
  return complianceKeyFromSignature(signature);
}

/**
 * Registers the compliance key: two device reviews (derive, then sign the registration of the public key).
 * Required before any anonymous desk share: identities are sealed to this key.
 */
export async function registerComplianceKey(input: {
  employee: EmployeeId;
}): Promise<ActionResult<EnrollmentView>> {
  return runAction(async () => {
    const { employee } = employeeSchema.parse(input);
    const { secretKey, publicKey } = await deriveComplianceKey(employee);
    secretKey.fill(0);
    const publicKeyHex = hex(publicKey);
    const signature = await signPersonalOnDevice(
      employee,
      complianceKeyRegistrationMessage(COMPANY_NAME, publicKeyHex),
    );
    const view = await enclave().registerComplianceKey(employee, { publicKey: publicKeyHex, signature });
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}

/**
 * Lifts the anonymity of one desk share: the sealed identity is opened here with the key re-derived on the
 * officer's Ledger, checked against the directory, and only then is the reveal logged in the enclave's audit.
 */
export async function revealDeskShare(input: {
  employee: EmployeeId;
  seq: number;
}): Promise<ActionResult<SealedIdentityView>> {
  return runAction(async () => {
    const { employee, seq } = revealSchema.parse(input);
    const api = enclave();
    const entry = (await api.audit(employee)).entries.find((e) => e.seq === seq && e.type === DESK_SHARE);
    if (entry === undefined) throw new EnclaveError("NOT_FOUND", `aucun partage anonyme à l'entrée ${seq}`);
    const { secretKey } = await deriveComplianceKey(employee);
    let plaintext: Uint8Array;
    try {
      plaintext = openSealed(secretKey, entry.data["sealedSigner"]);
    } finally {
      secretKey.fill(0);
    }
    const signer = sealedSignerSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
    // The sealed identity must name a directory employee with their own Ledger address, for this very request.
    if (!isAddressEqual(signer.address as `0x${string}`, EMPLOYEES[signer.employeeId].address)) {
      throw new EnclaveError("SIGNATURE_REJECTED", "l'identité scellée ne correspond pas à l'annuaire");
    }
    if (signer.requestId.toLowerCase() !== entry.subject.toLowerCase()) {
      throw new EnclaveError("SIGNATURE_REJECTED", "l'identité scellée vise une autre demande");
    }
    const view = await api.revealNotice(employee, { seq, reason: REVEAL_REASON, signer: signer.employeeId });
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}
