"use client";

import { type PointerEvent, type ReactNode, useRef } from "react";
import { magneticOffset } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface MagneticProps {
  children: ReactNode;
  /** Maximum pull towards the pointer, in px (default 6). */
  strength?: number;
  className?: string;
}

/**
 * Wraps a CTA so it leans towards the mouse pointer. Mouse only (touch and pen are ignored);
 * the CSS neutralises the offset when reduced motion is requested.
 */
export function Magnetic({ children, strength = 6, className }: MagneticProps) {
  const ref = useRef<HTMLSpanElement>(null);

  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const element = ref.current;
    if (!element || event.pointerType !== "mouse") return;
    const offset = magneticOffset(
      { x: event.clientX, y: event.clientY },
      element.getBoundingClientRect(),
      strength,
    );
    element.style.setProperty("--magnet-x", `${offset.x}px`);
    element.style.setProperty("--magnet-y", `${offset.y}px`);
  };

  const reset = () => {
    ref.current?.style.setProperty("--magnet-x", "0px");
    ref.current?.style.setProperty("--magnet-y", "0px");
  };

  return (
    <span ref={ref} className={cn("magnetic", className)} onPointerMove={move} onPointerLeave={reset}>
      {children}
    </span>
  );
}
