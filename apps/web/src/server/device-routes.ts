/**
 * Shared plumbing of the device route handlers (Ledger mirror): employee resolution, the cross-site request guard
 * and error responses.
 */
import { LedgerConnectionError, LedgerError } from "@badge/ledger";
import { z } from "zod";
import { isEmployeeId, type EmployeeId } from "@/lib/directory";
import { DEVICE_REQUEST_HEADER } from "@/lib/mirror";

const JSON_CONTENT_TYPE = "application/json";

/**
 * Refuses a device command that may come from another site (CSRF). Route handlers, unlike server actions, get no
 * Origin check from Next, and a page on any site open in the same browser could otherwise POST a "simple" request
 * (text/plain, no preflight) that taps or approves on the employee's Ledger. A command must therefore:
 * - carry no foreign Origin, and no Sec-Fetch-Site other than same-origin;
 * - be `application/json` and carry {@link DEVICE_REQUEST_HEADER}: both make a cross-site request non-simple, so
 *   the browser preflights it, and this app answers no CORS preflight.
 * @returns the refusal to send, or undefined when the request may proceed.
 */
export function crossSiteRefusal(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin !== null && (origin === "null" || new URL(origin).host !== host)) {
    return Response.json({ error: "cross-site device command refused" }, { status: 403 });
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return Response.json({ error: "cross-site device command refused" }, { status: 403 });
  }
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== JSON_CONTENT_TYPE) {
    return Response.json({ error: `device commands must be ${JSON_CONTENT_TYPE}` }, { status: 415 });
  }
  if (request.headers.get(DEVICE_REQUEST_HEADER) !== "1") {
    return Response.json({ error: `missing ${DEVICE_REQUEST_HEADER} header` }, { status: 403 });
  }
  return undefined;
}

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
