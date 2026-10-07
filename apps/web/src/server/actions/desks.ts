"use server";
/**
 * Anonymous desk exchange: join a desk with an identity derived from the Ledger, request across a desk rule, and
 * answer a request with a DeskShare signature plus a Semaphore proof made on this server (the device bridge).
 */
import { decodeBadgeMessage } from "@badge/consent";
import { UserRejectedError } from "@badge/ledger";
import { buildDeskGroup, createDeskProof, encodeDeskProof } from "@badge/zk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DESK_NAMES, EMPLOYEES, type DeskId, type EmployeeId } from "@/lib/directory";
import { enclave, type DeskRequestView, type DeskView } from "../enclave";
import { EnclaveError, runAction, type ActionResult } from "../errors";
import { deskIdentity } from "../keys";
import { buildDeskJoin } from "../messages";
import { signOnDevice } from "../signing";
import { bytes32Schema, deskIdSchema, employeeIdSchema, taskTextSchema } from "./schemas";
import type { ApprovalOutcome } from "./consents";

const joinSchema = z.object({ employee: employeeIdSchema, desk: deskIdSchema });

export async function joinDesk(input: {
  employee: EmployeeId;
  desk: DeskId;
}): Promise<ActionResult<DeskView>> {
  return runAction(async () => {
    const { employee, desk } = joinSchema.parse(input);
    // First device review: the identity derivation message (EIP-191). Second: the DeskJoin itself (EIP-712).
    const identity = await deskIdentity(employee);
    const message = buildDeskJoin(EMPLOYEES[employee], DESK_NAMES[desk], identity.commitment);
    const view = await enclave().joinDesk(employee, await signOnDevice(employee, "DeskJoin", message));
    revalidatePath(`/${employee}`, "layout");
    return view;
  });
}

const requestSchema = z.object({
  employee: employeeIdSchema,
  fromDesk: deskIdSchema,
  toDesk: deskIdSchema,
  task: taskTextSchema,
});

export async function requestFromDesk(
  input: z.input<typeof requestSchema>,
): Promise<ActionResult<DeskRequestView>> {
  return runAction(async () => {
    const { employee, ...request } = requestSchema.parse(input);
    const view = await enclave().createDeskRequest(employee, request);
    revalidatePath("/", "layout");
    return view;
  });
}

const answerSchema = z.object({ employee: employeeIdSchema, requestId: bytes32Schema });

export async function approveDeskShare(input: {
  employee: EmployeeId;
  requestId: string;
}): Promise<ActionResult<ApprovalOutcome>> {
  return runAction(async () => {
    const { employee, requestId } = answerSchema.parse(input);
    const api = enclave();
    const request = (await api.listDeskRequests(employee)).incoming.find((r) => r.id === requestId);
    if (request === undefined || request.status !== "pending") {
      throw new EnclaveError("NOT_FOUND", "demande introuvable ou déjà traitée");
    }
    const message = decodeBadgeMessage("DeskShare", request.message);
    const sourceDesk = (await api.listDesks(employee)).find((d) => DESK_NAMES[d.id] === message.sourceDesk);
    if (sourceDesk === undefined || !sourceDesk.joined) {
      throw new EnclaveError("FORBIDDEN", `rejoignez d'abord le desk ${message.sourceDesk}`);
    }
    try {
      const signed = await signOnDevice(employee, "DeskShare", message);
      const identity = await deskIdentity(employee);
      // The group comes from the enclave's registration order: the proof's root must equal the enclave's root.
      const group = buildDeskGroup(sourceDesk.commitments.map((c) => BigInt(c)));
      const proof = await createDeskProof({
        identity,
        group,
        excerptHash: message.excerptHash,
        requestId: message.requestId,
      });
      await api.approveDeskRequest(employee, message.requestId, signed, encodeDeskProof(proof));
      return "approved" as const;
    } catch (error) {
      if (!(error instanceof UserRejectedError)) throw error;
      await api.rejectDeskRequest(employee, message.requestId);
      return "rejected_on_device" as const;
    } finally {
      revalidatePath("/", "layout");
    }
  });
}

export async function rejectDeskShare(input: {
  employee: EmployeeId;
  requestId: string;
}): Promise<ActionResult> {
  return runAction(async () => {
    const { employee, requestId } = answerSchema.parse(input);
    await enclave().rejectDeskRequest(employee, requestId);
    revalidatePath("/", "layout");
    return undefined;
  });
}
