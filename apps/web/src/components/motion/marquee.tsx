"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useInView } from "./use-in-view";

export interface MarqueeProps {
  /** Items of one loop; the group is rendered twice (second copy hidden from assistive tech). */
  children: ReactNode;
  /** Accessible name of the scrolling region. */
  label: string;
  /** Duration of one full loop, in seconds (default 45). */
  duration?: number;
  /** Space between items, in px (default 80). */
  gap?: number;
  /** Scroll left to right. */
  reverse?: boolean;
  /** Pause while hovered or focused (default true). */
  pauseOnHover?: boolean;
  /** Render a round pause/play button (every infinite animation should be stoppable). */
  showPauseButton?: boolean;
  className?: string;
  groupClassName?: string;
}

/**
 * Infinite horizontal ticker. It pauses off-screen, on hover/focus and on demand; with reduced
 * motion it turns into a plain scrollable row.
 */
export function Marquee({
  children,
  label,
  duration = 45,
  gap = 80,
  reverse = false,
  pauseOnHover = true,
  showPauseButton = false,
  className,
  groupClassName,
}: MarqueeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, rootMargin: "0px" });
  const [paused, setPaused] = useState(false);
  const vars = { "--marquee-duration": `${duration}s`, "--marquee-gap": `${gap}px` } as CSSProperties;

  return (
    <div className={cn("relative", className)}>
      {showPauseButton && (
        <button
          type="button"
          className="marquee-pause mb-4 inline-flex size-[34px] items-center justify-center rounded-full border border-border text-foreground transition-colors duration-300 ease-out-soft hover:bg-muted"
          aria-pressed={paused}
          aria-label={paused ? "Resume scrolling" : "Pause scrolling"}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
        </button>
      )}
      <div
        ref={ref}
        role="region"
        aria-label={label}
        // Focusable so keyboard users can scroll the row when motion is reduced.
        tabIndex={0}
        className="marquee"
        style={vars}
        data-reverse={reverse ? "" : undefined}
        data-paused={paused ? "" : undefined}
        data-offscreen={inView ? undefined : ""}
        data-pause-on-hover={pauseOnHover ? "" : undefined}
      >
        <div className="marquee-track">
          <div className={cn("marquee-group", groupClassName)}>{children}</div>
          <div className={cn("marquee-group", groupClassName)} aria-hidden="true">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
