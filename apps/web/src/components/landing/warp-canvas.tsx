"use client";

import { type RefObject, useEffect, useRef } from "react";

/** Number of light streaks; one in `PERSONAL_EVERY` is personal context (violet). */
const STREAK_COUNT = 240;
const PERSONAL_EVERY = 5;
/** Golden angle: spreads the streaks evenly around the centre without visible spokes. */
const GOLDEN_ANGLE = 2.39996;
/** Depth travelled per second (1 = from the far plane to the camera). */
const WARP_SPEED = 0.11;
/** Pointer moves the vanishing point by this share of the canvas, eased by `POINTER_EASE`. */
const POINTER_REACH = 0.035;
const POINTER_EASE = 0.06;
/** Canvas resolution cap: sharper than this costs GPU time for no visible gain. */
const MAX_PIXEL_RATIO = 1.5;
/** Personal streaks stay this dim while held back at the rim (before the "signature"). */
const HELD_ALPHA = 0.16;

const GLOBAL_COLOUR = "137, 185, 255";
const PERSONAL_COLOUR = "168, 160, 244";

interface Streak {
  angle: number;
  spread: number;
  depth: number;
  personal: boolean;
}

function createStreaks(): Streak[] {
  return Array.from({ length: STREAK_COUNT }, (_, i) => ({
    angle: GOLDEN_ANGLE * i,
    spread: 0.35 + ((i * 7) % 11) / 11,
    depth: ((i * 0.618) % 1) + 0.02,
    personal: i % PERSONAL_EVERY === 0,
  }));
}

export interface WarpCanvasProps {
  /** 0 → 1: personal-context streaks are held at the rim, then join the flow. Read every frame. */
  gateRef: RefObject<number>;
  paused: boolean;
  /** Draw a single still frame (reduced motion). */
  still: boolean;
}

/**
 * Hero starfield: two streams of light rushing towards the viewer. Global context (blue) always
 * flows; personal context (violet) only joins once the hero's "+" has turned into a "✓", the visual
 * thesis of Badge. Runs only while visible, the tab is shown and the visitor has not paused it.
 */
export function WarpCanvas({ gateRef, paused, still }: WarpCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const streaks = createStreaks();
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let visible = true;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (dt: number) => {
      const gate = gateRef.current ?? 0;
      pointer.x += (pointer.targetX - pointer.x) * POINTER_EASE;
      pointer.y += (pointer.targetY - pointer.y) * POINTER_EASE;
      const cx = width / 2 + pointer.x * width * POINTER_REACH;
      const cy = height / 2 + pointer.y * height * POINTER_REACH;
      const reach = Math.max(width, height) * 0.08;

      const haze = context.createRadialGradient(cx, cy, 0, cx, cy, width * 0.38);
      haze.addColorStop(0, "#153e83");
      haze.addColorStop(0.12, "#0b1d42");
      haze.addColorStop(1, "#060010");
      context.fillStyle = haze;
      context.fillRect(0, 0, width, height);

      context.lineCap = "round";
      for (const streak of streaks) {
        // Held personal streaks barely move: they wait at the rim for the signature.
        const speed = streak.personal ? Math.max(0.04, gate) : 1;
        streak.depth -= WARP_SPEED * dt * speed;
        if (streak.depth <= 0.02) streak.depth += 1;

        const head = (reach * streak.spread) / streak.depth;
        const tail = (reach * streak.spread) / Math.min(1.05, streak.depth + 0.07);
        const cos = Math.cos(streak.angle);
        const sin = Math.sin(streak.angle);
        let alpha = Math.min(0.75, (1 - streak.depth) * 0.7);
        if (streak.personal) alpha *= HELD_ALPHA + (1 - HELD_ALPHA) * gate;

        context.strokeStyle = `rgba(${streak.personal ? PERSONAL_COLOUR : GLOBAL_COLOUR}, ${alpha.toFixed(3)})`;
        context.lineWidth = Math.max(0.6, 2.2 * (1 - streak.depth));
        context.beginPath();
        context.moveTo(cx + cos * tail, cy + sin * tail);
        context.lineTo(cx + cos * head, cy + sin * head);
        context.stroke();
      }

      const glow = context.createRadialGradient(cx, cy, 0, cx, cy, reach * 1.4);
      glow.addColorStop(0, "rgba(237, 245, 255, 0.9)");
      glow.addColorStop(0.25, "rgba(181, 214, 255, 0.35)");
      glow.addColorStop(1, "rgba(181, 214, 255, 0)");
      context.fillStyle = glow;
      context.fillRect(cx - reach * 1.4, cy - reach * 1.4, reach * 2.8, reach * 2.8);
    };

    const loop = (time: number) => {
      const dt = last === 0 ? 0 : Math.min(0.05, (time - last) / 1000);
      last = time;
      draw(dt);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (frame !== 0 || still || paused || !visible || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = canvas.getBoundingClientRect();
      pointer.targetX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.targetY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(0);
    });
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    });
    intersection.observe(canvas);

    resize();
    draw(still ? 0 : 0.5);
    start();
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gateRef, paused, still]);

  return <canvas ref={canvasRef} aria-hidden="true" className="lp-warp absolute inset-0 size-full" />;
}
