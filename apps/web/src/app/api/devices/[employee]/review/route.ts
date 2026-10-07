/**
 * POST: rehearsal helper. Walks the review currently on the device and approves ("Hold to sign") or rejects it.
 * Speculos only; in the real product the employee reviews on their own Ledger.
 */
import { z } from "zod";
import { deviceScreen } from "@/server/devices";
import { deviceErrorResponse, employeeFrom, type DeviceRouteContext } from "@/server/device-routes";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export async function POST(request: Request, context: DeviceRouteContext): Promise<Response> {
  try {
    const device = deviceScreen(await employeeFrom(context));
    const { decision } = reviewSchema.parse(await request.json());
    if (decision === "reject") {
      await device.reject();
      return Response.json({ ok: true, pages: 0 });
    }
    const pages = await device.approveReview();
    return Response.json({ ok: true, pages: pages.length });
  } catch (error) {
    return deviceErrorResponse(error);
  }
}
