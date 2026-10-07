/**
 * Data loading for server components. Production builds redact thrown errors, so pages load through
 * {@link load} and render the typed failure (e.g. live mode not wired, enclave refusal) instead of crashing.
 */
import { notFound } from "next/navigation";
import { EMPLOYEES, isEmployeeId, type Employee } from "@/lib/directory";
import { runAction, type ActionResult } from "./errors";

export function load<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  return runAction(work);
}

/** Resolves the `[employee]` route segment or renders the 404 page. */
export async function employeeFromParams(params: Promise<{ employee: string }>): Promise<Employee> {
  const { employee } = await params;
  if (!isEmployeeId(employee)) notFound();
  return EMPLOYEES[employee];
}
