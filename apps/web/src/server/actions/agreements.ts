"use server";
/**
 * Standing agreements (ContextPolicy) and revocations (ContextRevoke), signed on the owner's Ledger.
 */
import { toUnixSeconds } from "@badge/consent";
import { revalidatePath } from "next/cache";
import type { Hex } from "viem";
import { z } from "zod";
import { EMPLOYEES, TEAMS, type EmployeeId } from "@/lib/directory";
import { enclave, type PolicyView } from "../enclave";
import { EnclaveError, runAction, type ActionResult } from "../errors";
import { buildContextPolicy, MAX_POLICY_DAYS } from "../messages";
import { signOnDevice } from "../signing";
import { bytes32Schema, employeeIdSchema } from "./schemas";

/** Bounds of the per-excerpt cap offered in the form (characters). */
const MIN_EXCERPT_CAP = 50;
const MAX_EXCERPT_CAP = 4000;

const policySchema = z.object({
  employee: employeeIdSchema,
  granteeTeam: z.enum(TEAMS),
  contextTag: z.string().trim().min(1).max(40),
  purpose: z.string().trim().min(3).max(60),
  maxExcerptLength: z.number().int().min(MIN_EXCERPT_CAP).max(MAX_EXCERPT_CAP),
  durationDays: z.number().int().min(1).max(MAX_POLICY_DAYS),
});

export async function createStandingAgreement(
  input: z.input<typeof policySchema>,
): Promise<ActionResult<PolicyView>> {
  return runAction(async () => {
    const { employee, ...policy } = policySchema.parse(input);
    const api = enclave();
    const tags = await api.contextTags(employee);
    if (!tags.includes(policy.contextTag)) {
      throw new EnclaveError("INVALID_REQUEST", `unknown context tag: ${policy.contextTag}`);
    }
    const { measurement } = await api.attestation();
    const message = buildContextPolicy(EMPLOYEES[employee], policy, measurement, toUnixSeconds(new Date()));
    const view = await api.createPolicy(employee, await signOnDevice(employee, "ContextPolicy", message));
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}

const revokeSchema = z.object({ employee: employeeIdSchema, grantId: bytes32Schema });

/** Revokes one grant or standing agreement, with the label the enclave prepared for exactly that target. */
export async function revokeGrant(input: {
  employee: EmployeeId;
  grantId: string;
}): Promise<ActionResult<{ revoked: number }>> {
  return runAction(async () => {
    const { employee, grantId } = revokeSchema.parse(input);
    const api = enclave();
    const message = await api.prepareRevocation(employee, { grantId: grantId as Hex });
    const result = await api.revoke(employee, await signOnDevice(employee, "ContextRevoke", message));
    revalidatePath(`/${employee}`, "layout");
    return result;
  });
}

const revokeAllSchema = z.object({ employee: employeeIdSchema, recipient: employeeIdSchema });

/**
 * Revokes everything the owner shared with one colleague (ContextRevoke with grantId 0x0): every one-off grant to
 * their address and the standing agreements granted to their team, as the prepared device label says. One
 * signature, one key rotation.
 */
export async function revokeAllFor(input: {
  employee: EmployeeId;
  recipient: EmployeeId;
}): Promise<ActionResult<{ revoked: number }>> {
  return runAction(async () => {
    const { employee, recipient } = revokeAllSchema.parse(input);
    if (employee === recipient) throw new EnclaveError("INVALID_REQUEST", "nothing to revoke for yourself");
    const api = enclave();
    const message = await api.prepareRevocation(employee, { recipient });
    const result = await api.revoke(employee, await signOnDevice(employee, "ContextRevoke", message));
    revalidatePath("/", "layout");
    return result;
  });
}
