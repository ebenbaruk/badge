"use server";
/**
 * Compliance actions (role compliance only, enforced by the enclave).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EmployeeId } from "@/lib/directory";
import { enclave, type SealedIdentityView } from "../enclave";
import { runAction, type ActionResult } from "../errors";
import { employeeIdSchema } from "./schemas";

const revealSchema = z.object({ employee: employeeIdSchema, seq: z.number().int().positive() });

/**
 * Lifts the anonymity of one desk share. Mock: the enclave decrypts in place. Live (to wire): the sealed identity
 * is decrypted client-side with a key derived from the compliance officer's Ledger, then a reveal notice is logged.
 */
export async function revealDeskShare(input: {
  employee: EmployeeId;
  seq: number;
}): Promise<ActionResult<SealedIdentityView>> {
  return runAction(async () => {
    const { employee, seq } = revealSchema.parse(input);
    const view = await enclave().revealDeskShare(employee, seq);
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}
