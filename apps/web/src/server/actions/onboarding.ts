"use server";
/**
 * Enrollment (EmployeeEnroll) and agent delegation (AgentSession), both signed on the employee's Ledger and pinned
 * to the measurement of the attested enclave.
 */
import { toUnixSeconds } from "@badge/consent";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { enclave, type EnrollmentView } from "../enclave";
import { runAction, type ActionResult } from "../errors";
import { rotateAgentSessionAccount } from "../keys";
import { buildAgentSession, buildEmployeeEnroll } from "../messages";
import { signOnDevice } from "../signing";
import { employeeIdSchema } from "./schemas";

const inputSchema = z.object({ employee: employeeIdSchema });

export async function enrollEmployee(input: { employee: EmployeeId }): Promise<ActionResult<EnrollmentView>> {
  return runAction(async () => {
    const { employee } = inputSchema.parse(input);
    const api = enclave();
    const { measurement } = await api.attestation();
    const message = buildEmployeeEnroll(EMPLOYEES[employee], measurement, toUnixSeconds(new Date()));
    const view = await api.enroll(await signOnDevice(employee, "EmployeeEnroll", message));
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}

export async function authorizeAgent(input: { employee: EmployeeId }): Promise<ActionResult<EnrollmentView>> {
  return runAction(async () => {
    const { employee } = inputSchema.parse(input);
    const api = enclave();
    const { measurement } = await api.attestation();
    // A fresh key per delegation: an old session key must never be revalidated by a new signature.
    const sessionKey = rotateAgentSessionAccount(employee).address;
    const message = buildAgentSession(
      EMPLOYEES[employee],
      sessionKey,
      measurement,
      toUnixSeconds(new Date()),
    );
    const view = await api.openSession(employee, await signOnDevice(employee, "AgentSession", message));
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}
