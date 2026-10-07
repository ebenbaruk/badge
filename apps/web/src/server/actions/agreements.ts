"use server";
/**
 * Standing agreements (ContextPolicy) and revocations (ContextRevoke), signed on the owner's Ledger.
 */
import { toUnixSeconds } from "@badge/consent";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EMPLOYEES, TEAMS, type EmployeeId } from "@/lib/directory";
import { enclave, type PolicyView } from "../enclave";
import { EnclaveError, runAction, type ActionResult } from "../errors";
import { buildContextPolicy, buildContextRevoke, deviceName, MAX_POLICY_DAYS } from "../messages";
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
      throw new EnclaveError("INVALID_REQUEST", `étiquette de contexte inconnue : ${policy.contextTag}`);
    }
    const { measurement } = await api.attestation();
    const message = buildContextPolicy(EMPLOYEES[employee], policy, measurement, toUnixSeconds(new Date()));
    const view = await api.createPolicy(employee, await signOnDevice(employee, "ContextPolicy", message));
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}

const revokeSchema = z.object({ employee: employeeIdSchema, grantId: bytes32Schema });

export async function revokeGrant(input: {
  employee: EmployeeId;
  grantId: string;
}): Promise<ActionResult<{ revoked: number }>> {
  return runAction(async () => {
    const { employee, grantId } = revokeSchema.parse(input);
    const api = enclave();
    const grant = (await api.listGrants(employee)).find((g) => g.id === grantId && g.status === "active");
    if (grant === undefined) throw new EnclaveError("NOT_FOUND", "accord introuvable ou déjà révoqué");
    const recipient = grant.recipient === undefined ? undefined : EMPLOYEES[grant.recipient];
    const targetLabel =
      recipient === undefined
        ? `${grant.recipientLabel} - ${grant.label}`
        : `${deviceName(recipient)} - ${grant.label}`;
    const message = buildContextRevoke(
      EMPLOYEES[employee],
      { grantId, targetLabel, ...(recipient === undefined ? {} : { recipient: recipient.address }) },
      toUnixSeconds(new Date()),
    );
    const result = await api.revoke(employee, await signOnDevice(employee, "ContextRevoke", message));
    revalidatePath(`/${employee}`, "layout");
    return result;
  });
}
