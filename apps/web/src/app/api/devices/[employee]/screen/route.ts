/**
 * GET: PNG capture of the employee's Speculos screen, polled by the Ledger mirror (a few frames per second).
 */
import { deviceScreen } from "@/server/devices";
import { deviceErrorResponse, employeeFrom, type DeviceRouteContext } from "@/server/device-routes";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: DeviceRouteContext): Promise<Response> {
  try {
    const png = await deviceScreen(await employeeFrom(context)).screenshot();
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (error) {
    return deviceErrorResponse(error);
  }
}
