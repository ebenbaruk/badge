"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";
import { scrollProgress, scrollTravel } from "./scroll-math";

export interface ScrollFrame {
  /** 0 → 1 through a tall element with a sticky child. */
  progress: number;
  /** -1 → 1 relative to the viewport centre. */
  travel: number;
  /** Viewport-relative top of the element, in px. */
  top: number;
  /** Viewport height, in px. */
  viewport: number;
}

/**
 * Writes `--progress` and `--travel` on an element at most once per animation frame while the page
 * scrolls, so CSS drives the choreography without React re-rendering. `onFrame` receives the same
 * values for the rare scene that needs them in JavaScript (the hero canvas, the consent story).
 */
export function useScrollVars(
  ref: RefObject<HTMLElement | null>,
  onFrame?: (frame: ScrollFrame, element: HTMLElement) => void,
): void {
  const notify = useEffectEvent((frame: ScrollFrame, element: HTMLElement) => onFrame?.(frame, element));

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let request = 0;

    const update = () => {
      request = 0;
      const rect = element.getBoundingClientRect();
      const viewport = window.innerHeight;
      const frame: ScrollFrame = {
        progress: scrollProgress(rect.top, rect.height, viewport),
        travel: scrollTravel(rect.top, rect.height, viewport),
        top: rect.top,
        viewport,
      };
      element.style.setProperty("--progress", frame.progress.toFixed(4));
      element.style.setProperty("--travel", frame.travel.toFixed(4));
      notify(frame, element);
    };
    const schedule = () => {
      if (request === 0) request = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Web fonts change heights after the first measure.
    void document.fonts?.ready.then(schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (request !== 0) cancelAnimationFrame(request);
    };
  }, [ref]);
}
