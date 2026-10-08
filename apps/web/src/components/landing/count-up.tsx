"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "@/components/motion/use-in-view";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";

const COUNT_MS = 900;

/**
 * Number that counts up from 0 the first time it scrolls into view. Screen readers and the
 * server-rendered HTML get the final value; the moving digits are decorative.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (!inView || reducedMotion || value === 0) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      // Ease-out cubic: fast start, settles on the value.
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reducedMotion, value]);

  return (
    <span ref={ref} className={className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="tabular-nums">
        {shown ?? value}
      </span>
    </span>
  );
}
