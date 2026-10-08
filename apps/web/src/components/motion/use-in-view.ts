"use client";

import { type RefObject, useEffect, useState } from "react";
import { REVEAL_ROOT_MARGIN, REVEAL_THRESHOLD } from "@/lib/motion";

/**
 * Tracks whether an element is in the viewport. With `once`, it stays `true` after the first
 * intersection (reveals); without, it toggles (pausing loops while off-screen).
 */
export function useInView(
  ref: RefObject<Element | null>,
  { once = true, threshold = REVEAL_THRESHOLD, rootMargin = REVEAL_ROOT_MARGIN } = {},
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Old engines without IntersectionObserver: show the content rather than hide it forever.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) observer.disconnect();
      },
      { threshold, rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, once, threshold, rootMargin]);

  return inView;
}
