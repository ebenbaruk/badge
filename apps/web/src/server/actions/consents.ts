"use server";
/**
 * Consent inbox actions: the owner approves a request by clear-signing, on their own Ledger, the exact
 * ContextShare the enclave prepared (never a message rebuilt by the web app).
 */
import { decodeBadgeMessage } from "@badge/consent";
import { UserRejectedError } from "@badge/ledger";
import { revalidatePath } from "next/cache";
import { isAddressEqual } from "viem";
import { z } from "zod";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { enclave } from "../enclave";
import { EnclaveError, runAction, type ActionResult } from "../errors";
import { signOnDevice } from "../signing";
import { employeeIdSchema } from "./schemas";

/** Outcome of an approval: signed, or refused on the device (which also refuses the request). */
export type ApprovalOutcome = "approved" | "rejected_on_device";

const consentInputSchema = z.object({ employee: employeeIdSchema, consentId: z.string().min(1).max(100) });

export async function approveConsent(input: {
  employee: EmployeeId;
  consentId: string;
}): Promise<ActionResult<ApprovalOutcome>> {
  return runAction(async () => {
    const { employee, consentId } = consentInputSchema.parse(input);
    const api = enclave();
    const request = (await api.listConsents(employee)).find((c) => c.id === consentId);
    if (request === undefined || request.status !== "pending") {
      throw new EnclaveError("NOT_FOUND", "demande introuvable ou déjà traitée");
    }
    // Decode strictly (canonical ASCII, ranges) and refuse a message that does not name this owner.
    const message = decodeBadgeMessage("ContextShare", request.message);
    if (!isAddressEqual(message.owner, EMPLOYEES[employee].address)) {
      throw new EnclaveError("FORBIDDEN", "cette demande ne vous est pas adressée");
    }
    try {
      const signed = await signOnDevice(employee, "ContextShare", message);
      await api.approveConsent(employee, consentId, signed.signature);
      return "approved" as const;
    } catch (error) {
      if (!(error instanceof UserRejectedError)) throw error;
      // Rejecting on the device is the owner's decision: record it, so the requester's task stops waiting.
      await api.rejectConsent(employee, consentId);
      return "rejected_on_device" as const;
    } finally {
      revalidatePath("/", "layout");
    }
  });
}

export async function rejectConsent(input: {
  employee: EmployeeId;
  consentId: string;
}): Promise<ActionResult> {
  return runAction(async () => {
    const { employee, consentId } = consentInputSchema.parse(input);
    await enclave().rejectConsent(employee, consentId);
    revalidatePath("/", "layout");
    return undefined;
  });
}
