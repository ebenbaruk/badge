"use client";

import { type CSSProperties, type ReactNode, useRef } from "react";
import { useInView } from "./use-in-view";

/** Block-level tags a reveal wrapper may render as. */
export type RevealTag =
  "div" | "section" | "article" | "header" | "footer" | "li" | "ul" | "ol" | "p" | "span" | "figure";

export interface RevealProps {
  children: ReactNode;
  as?: RevealTag;
  className?: string;
  style?: CSSProperties;
  /** Delay before the transition starts, in ms. */
  delay?: number;
  /** Starting vertical offset, in px (default 24). */
  y?: number;
  /** Starting blur, in px (default 0). */
  blur?: number;
  /** Re-hide when leaving the viewport (default: reveal once). */
  repeat?: boolean;
  id?: string;
}

/**
 * Fades and lifts its content in when it scrolls into view (CSS transition on `data-visible`).
 * Without JavaScript or with reduced motion, the content is simply visible.
 */
export function Reveal({
  children,
  as = "div",
  className,
  style,
  delay = 0,
  y,
  blur,
  repeat = false,
  id,
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref, { once: !repeat });
  // A union of intrinsic tags is not callable as one JSX type; they all accept these props.
  const Tag = as as "div";
  const vars = {
    "--reveal-delay": `${delay}ms`,
    ...(y === undefined ? {} : { "--reveal-y": `${y}px` }),
    ...(blur === undefined ? {} : { "--reveal-blur": `${blur}px` }),
    ...style,
  } as CSSProperties;
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      id={id}
      className={className}
      style={vars}
      data-reveal=""
      data-visible={visible ? "" : undefined}
    >
      {children}
    </Tag>
  );
}
