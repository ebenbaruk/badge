"use client";

import { Hand, Loader2, Radio, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EmployeeId } from "@/lib/directory";
import {
  classifyGesture,
  DEVICE_REQUEST_HEADER,
  FLEX_SCREEN_SIZE,
  LONG_PRESS_MS,
  toDevicePoint,
  type MirrorGesture,
  type Point,
} from "@/lib/mirror";
import { cn } from "@/lib/utils";
import { useLedgerActivity } from "./ledger-activity";

/** ~5 fps while a review is expected: smooth enough to read the device, light on Speculos. */
const LIVE_FRAME_INTERVAL_MS = 200;
/** Idle refresh: the device still shows its home screen, keep it current without hammering Speculos. */
const IDLE_FRAME_INTERVAL_MS = 1500;
/**
 * Hidden tab (background, or window covered by another one: macOS reports it hidden too) and no review expected:
 * keep a slow refresh rather than none, so the mirror never stays on its spinner when the window is shown again.
 */
const HIDDEN_FRAME_INTERVAL_MS = 5000;
/** Back-off after a failed frame (device down): avoid a tight error loop. */
const ERROR_RETRY_MS = 3000;
/** How long a touch ripple stays on the mirror: `animate-ping` loops forever, so it is removed after one beat. */
const RIPPLE_MS = 700;
/** Duration of the hold forwarded to the device (matches HOLD_TO_SIGN_MS of @badge/ledger). */
const HOLD_FEEDBACK_MS = 3000;

type ReviewDecision = "approve" | "reject";

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", [DEVICE_REQUEST_HEADER]: "1" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
}

/**
 * Live mirror of an employee's Speculos Flex. Click to tap, press and hold to "Hold to sign", drag left to turn a
 * review page. The device stays the source of truth: the mirror only forwards touches, it never signs.
 */
export function LedgerMirror({
  employee,
  deviceLabel,
  rehearsal,
}: {
  employee: EmployeeId;
  deviceLabel: string;
  /** Shows the automatic review buttons (BADGE_REHEARSAL=1 only). */
  rehearsal: boolean;
}) {
  const { activity } = useLedgerActivity();
  const [frame, setFrame] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [holding, setHolding] = useState(false);
  const [ripple, setRipple] = useState<(Point & { key: number }) | null>(null);
  const [reviewing, setReviewing] = useState<ReviewDecision | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ client: Point; at: number; consumed: boolean; timer: number } | null>(null);
  const live = activity !== null || hovered || holding || reviewing !== null;
  // Read by the polling loop without restarting it on every change.
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let previousUrl: string | null = null;
    const tick = async (): Promise<void> => {
      let delay = liveRef.current
        ? LIVE_FRAME_INTERVAL_MS
        : document.hidden
          ? HIDDEN_FRAME_INTERVAL_MS
          : IDLE_FRAME_INTERVAL_MS;
      try {
        const response = await fetch(`/api/devices/${employee}/screen?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setFrame(url);
        if (previousUrl !== null) URL.revokeObjectURL(previousUrl);
        previousUrl = url;
        setOffline(false);
      } catch {
        // A missing frame is shown as "device unreachable"; the next tick retries.
        setOffline(true);
        delay = ERROR_RETRY_MS;
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (previousUrl !== null) URL.revokeObjectURL(previousUrl);
    };
  }, [employee]);

  const send = useCallback(
    async (gesture: MirrorGesture) => {
      const body =
        gesture.kind === "swipe-next" ? { kind: gesture.kind } : { kind: gesture.kind, ...gesture.at };
      try {
        await postJson(`/api/devices/${employee}/input`, body);
      } catch (error) {
        toast.error("Geste non transmis au Ledger", { description: String(error) });
      }
    },
    [employee],
  );

  const devicePointOf = (event: { clientX: number; clientY: number }): Point | null => {
    const element = screenRef.current;
    if (element === null) return null;
    return toDevicePoint({ x: event.clientX, y: event.clientY }, element.getBoundingClientRect());
  };

  const showRipple = (point: Point): void => setRipple({ ...point, key: Date.now() });
  useEffect(() => {
    if (ripple === null) return;
    const timer = window.setTimeout(() => setRipple(null), RIPPLE_MS);
    return () => window.clearTimeout(timer);
  }, [ripple]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const client = { x: event.clientX, y: event.clientY };
    const timer = window.setTimeout(() => {
      const current = press.current;
      const at = devicePointOf({ clientX: client.x, clientY: client.y });
      if (current === null || at === null) return;
      // Forward the hold as soon as it is recognised, so the device's 3 s countdown starts under the finger.
      current.consumed = true;
      setHolding(true);
      showRipple(at);
      void send({ kind: "hold", at }).finally(() => setHolding(false));
    }, LONG_PRESS_MS);
    press.current = { client, at: Date.now(), consumed: false, timer };
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const current = press.current;
    press.current = null;
    if (current === null) return;
    window.clearTimeout(current.timer);
    if (current.consumed) return;
    const down = devicePointOf({ clientX: current.client.x, clientY: current.client.y });
    const up = devicePointOf(event);
    if (down === null || up === null) return;
    const gesture = classifyGesture(down, up, Date.now() - current.at);
    if (gesture.kind !== "swipe-next") showRipple(gesture.at);
    void send(gesture);
  };

  const review = async (decision: ReviewDecision): Promise<void> => {
    setReviewing(decision);
    try {
      await postJson(`/api/devices/${employee}/review`, { decision });
    } catch (error) {
      toast.error("La revue automatique n'a pas abouti", { description: String(error) });
    } finally {
      setReviewing(null);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center justify-between gap-3">
        <span className="min-w-0 truncate mono-label text-[10px] text-muted-foreground">{deviceLabel}</span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-2 py-1 mono-chip transition-colors duration-300",
            offline
              ? "border-danger/35 text-danger"
              : live
                ? "border-success/35 text-success"
                : "text-muted-foreground",
          )}
        >
          <Radio className={cn("size-3", live && !offline && "animate-pulse")} />
          {offline ? "Injoignable" : live ? "En direct" : "Veille"}
        </span>
      </div>

      {/* Ledger Flex: thick graphite bezel around a 480 x 600 touch screen; it glows while a signature is awaited. */}
      <div className="relative w-full max-w-[300px]" data-awaiting={activity !== null ? "" : undefined}>
        <span aria-hidden className="app-ledger-glow" />
        <div
          className={cn(
            "relative rounded-[30px] bg-gradient-to-b from-graphite-2 to-night p-[14px] shadow-[0_24px_48px_-20px_#06001099] ring-1 ring-black/40 transition-[scale] duration-500 ease-out-soft",
            activity !== null && "scale-[1.02]",
          )}
        >
          <div className="absolute top-1/2 -right-[3px] h-14 w-[3px] -translate-y-1/2 rounded-r bg-graphite" />
          <div
            ref={screenRef}
            role="application"
            aria-label={`Écran du Ledger : cliquer pour toucher, maintenir pour « Hold to sign », glisser vers la gauche pour la page suivante`}
            className="relative cursor-pointer touch-none overflow-hidden rounded-[16px] bg-white select-none"
            style={{ aspectRatio: `${FLEX_SCREEN_SIZE.width} / ${FLEX_SCREEN_SIZE.height}` }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              if (press.current !== null) window.clearTimeout(press.current.timer);
              press.current = null;
            }}
          >
            {frame === null ? (
              <div className="flex size-full items-center justify-center text-neutral-400">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : (
              // Object URL of the latest PNG frame: next/image adds nothing for a 5 fps local stream.
              <img src={frame} alt="" draggable={false} className="pointer-events-none size-full" />
            )}
            {offline && frame !== null && (
              <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px]" />
            )}
            {ripple !== null && (
              <span
                key={ripple.key}
                className="pointer-events-none absolute size-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-signal/50"
                style={{
                  left: `${(ripple.x / FLEX_SCREEN_SIZE.width) * 100}%`,
                  top: `${(ripple.y / FLEX_SCREEN_SIZE.height) * 100}%`,
                }}
              />
            )}
            {holding && (
              <div className="absolute inset-x-0 bottom-0 h-1.5 bg-fog">
                <div
                  className="h-full bg-gradient-to-r from-signal to-violet-glow"
                  style={{ animation: `badge-hold ${HOLD_FEEDBACK_MS}ms linear forwards` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-center text-[11px] leading-tight text-muted-foreground/90">
        <Hand className="size-3 shrink-0" />
        Cliquer pour toucher · maintenir pour signer · glisser pour défiler
      </p>

      {rehearsal && (
        <div className="flex w-full gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={reviewing !== null || offline}
                onClick={() => void review("approve")}
              >
                {reviewing === "approve" ? <Loader2 className="animate-spin" /> : <Wand2 />}
                Revue auto
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Répétition : parcourt la revue affichée et maintient « Hold to sign ».
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={reviewing !== null || offline}
                onClick={() => void review("reject")}
              >
                {reviewing === "reject" ? <Loader2 className="animate-spin" /> : <X />}
                Refuser
              </Button>
            </TooltipTrigger>
            <TooltipContent>Répétition : refuse la revue affichée sur l&apos;appareil.</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
