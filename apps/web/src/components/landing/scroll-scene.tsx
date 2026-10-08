"use client";

import { type CSSProperties, type PointerEvent, type ReactNode, useRef } from "react";
import { unfoldAmount } from "./scroll-math";
import { useScrollVars } from "./use-scroll-vars";

/** Largest tilt of a sculpture towards the pointer, in degrees (±). */
const MAX_TILT_DEG = 4;

export interface ScrollSceneProps {
  children: ReactNode;
  as?: "section" | "div" | "article" | "footer";
  id?: string;
  className?: string;
  style?: CSSProperties;
  "aria-labelledby"?: string;
  /** Track the mouse: `--pointer-x/y` (px) for the follow pill and `--tilt-x/y` (deg) for the art. */
  pointer?: boolean;
  /** Also write `--unfold` (0 → 1) for the panel that grows out of the nav pill. */
  unfold?: boolean;
}

/**
 * Client wrapper that exposes the scroll position of its element to CSS (`--progress`, `--travel`,
 * optionally `--unfold`) and, on demand, the pointer position. Children stay server-rendered.
 */
export function ScrollScene({
  children,
  as = "div",
  id,
  className,
  style,
  pointer = false,
  unfold = false,
  ...aria
}: ScrollSceneProps) {
  const ref = useRef<HTMLElement>(null);
  useScrollVars(ref, (frame, element) => {
    if (unfold) element.style.setProperty("--unfold", unfoldAmount(frame.top, frame.viewport).toFixed(4));
  });

  // Mouse only: a finger has no hover, and the follow pill would sit under it.
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse") return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    element.style.setProperty("--pointer-x", `${x}px`);
    element.style.setProperty("--pointer-y", `${y}px`);
    element.style.setProperty("--tilt-y", `${((x / rect.width) * 2 - 1) * MAX_TILT_DEG}deg`);
    element.style.setProperty("--tilt-x", `${-((y / rect.height) * 2 - 1) * MAX_TILT_DEG}deg`);
    element.dataset.pointer = "";
  };
  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    const element = event.currentTarget;
    element.style.setProperty("--tilt-x", "0deg");
    element.style.setProperty("--tilt-y", "0deg");
    delete element.dataset.pointer;
  };

  const Tag = as as "div";
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      id={id}
      className={className}
      style={style}
      data-scene=""
      onPointerMove={pointer ? onPointerMove : undefined}
      onPointerLeave={pointer ? onPointerLeave : undefined}
      {...aria}
    >
      {children}
    </Tag>
  );
}
