"use client";

import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useEffect } from "react";

/** Only a mouse wheel or trackpad gets smoothing, and only when the reader accepts motion. */
const SMOOTH_QUERY = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

/** Same inertia as the reference landing: noticeably soft, never sluggish. */
const SCROLL_LERP = 0.12;

/** Scrollable areas that must keep native wheel behaviour (menu dialog, marquee, code blocks). */
function keepsNativeScroll(node: HTMLElement): boolean {
  return node.matches("dialog, .marquee, pre, [data-lenis-prevent]");
}

/**
 * Smooth wheel scrolling for the landing page (Lenis). Touch scrolling stays native; the instance
 * is created or destroyed whenever the pointer or motion preference changes. Scroll-driven scenes
 * keep working because Lenis moves the real window scroll position.
 */
export function SmoothScroll() {
  useEffect(() => {
    const media = window.matchMedia(SMOOTH_QUERY);
    let lenis: Lenis | null = null;

    const sync = () => {
      if (media.matches && !lenis) {
        lenis = new Lenis({
          lerp: SCROLL_LERP,
          smoothWheel: true,
          syncTouch: false,
          anchors: true,
          autoRaf: true,
          prevent: keepsNativeScroll,
        });
      } else if (!media.matches && lenis) {
        lenis.destroy();
        lenis = null;
      }
    };

    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      lenis?.destroy();
    };
  }, []);

  return null;
}
