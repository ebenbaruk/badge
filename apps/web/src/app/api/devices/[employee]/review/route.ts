/**
 * POST: rehearsal helper. Walks the review currently on the device and approves ("Hold to sign") or rejects it.
 * Speculos only, and only with BADGE_REHEARSAL=1: anywhere else the employee reviews and signs by hand, since an
 * endpoint that signs whatever the device shows defeats the point of reading it.
 */
import { z } from "zod";
import { serverConfig } from "@/server/config";
import { deviceScreen } from "@/server/devices";
import {
  crossSiteRefusal,
  deviceErrorResponse,
  employeeFrom,
  type DeviceRouteContext,
} from "@/server/device-routes";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export async function POST(request: Request, context: DeviceRouteContext): Promise<Response> {
  if (!serverConfig().rehearsal) {
    return Response.json({ error: "automatic review is only available in rehearsal mode" }, { status: 404 });
  }
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
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
