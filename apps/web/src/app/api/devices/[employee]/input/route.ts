/**
 * POST: forwards a gesture from the Ledger mirror to the device (tap, long press for "Hold to sign", swipe).
 * Coordinates are device pixels (the client scales them); @badge/ledger rounds and clamps them again.
 */
import { HOLD_TO_SIGN_MS } from "@badge/ledger";
import { z } from "zod";
import { FLEX_SCREEN_SIZE } from "@/lib/mirror";
import { deviceScreen } from "@/server/devices";
import {
  crossSiteRefusal,
  deviceErrorResponse,
  employeeFrom,
  type DeviceRouteContext,
} from "@/server/device-routes";

export const dynamic = "force-dynamic";

const x = z.number().min(0).max(FLEX_SCREEN_SIZE.width);
const y = z.number().min(0).max(FLEX_SCREEN_SIZE.height);
const gestureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tap"), x, y }),
  z.object({ kind: z.literal("hold"), x, y }),
  z.object({ kind: z.literal("swipe-next") }),
]);

export async function POST(request: Request, context: DeviceRouteContext): Promise<Response> {
  const refusal = crossSiteRefusal(request);
  if (refusal) return refusal;
  try {
    const device = deviceScreen(await employeeFrom(context));
    const gesture = gestureSchema.parse(await request.json());
    switch (gesture.kind) {
      case "tap":
        await device.tap(gesture.x, gesture.y);
        break;
      case "hold":
        // Always the full "Hold to sign" duration: a shorter real press would not validate the signature.
        await device.hold(gesture.x, gesture.y, HOLD_TO_SIGN_MS);
        break;
      case "swipe-next":
        await device.swipeNext();
        break;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return deviceErrorResponse(error);
  }
}
