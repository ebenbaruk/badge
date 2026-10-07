/**
 * Shared plumbing of the device route handlers (Ledger mirror): employee resolution and error responses.
 */
import { LedgerConnectionError, LedgerError } from "@badge/ledger";
import { z } from "zod";
import { isEmployeeId, type EmployeeId } from "@/lib/directory";

export interface DeviceRouteContext {
  params: Promise<{ employee: string }>;
}

export class UnknownEmployeeError extends Error {
  override readonly name = "UnknownEmployeeError";
}

export async function employeeFrom(context: DeviceRouteContext): Promise<EmployeeId> {
  const { employee } = await context.params;
  if (!isEmployeeId(employee)) throw new UnknownEmployeeError(`unknown employee: ${employee}`);
  return employee;
}

/** Maps errors to JSON responses: 404 unknown employee, 400 bad input, 503 device down, 502 device error. */
export function deviceErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof UnknownEmployeeError) return Response.json({ error: message }, { status: 404 });
  if (error instanceof z.ZodError) {
    return Response.json({ error: z.prettifyError(error) }, { status: 400 });
  }
  console.error("[badge/web] device route", error);
  if (error instanceof LedgerConnectionError) return Response.json({ error: message }, { status: 503 });
  if (error instanceof LedgerError) return Response.json({ error: message }, { status: 502 });
  return Response.json({ error: "internal error" }, { status: 500 });
}
