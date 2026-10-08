"use client";

import { Children, type CSSProperties, type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";
import { useInView } from "./use-in-view";

export interface StaggerProps {
  children: ReactNode;
  /** `ul`/`ol` wrap each child in an `li`; other tags wrap it in a `div`. */
  as?: "div" | "ul" | "ol" | "section";
  className?: string;
  /** Class of the wrapper around each child (grid cells, list rows...). */
  itemClassName?: string;
  /** Delay between two consecutive children, in ms (default 70). */
  step?: number;
  /** Delay before the first child, in ms. */
  delay?: number;
  /** Starting vertical offset of each child, in px (default 18). */
  y?: number;
}

/** Reveals its children one after another when the group scrolls into view. */
export function Stagger({
  children,
  as = "div",
  className,
  itemClassName,
  step = 70,
  delay = 0,
  y,
}: StaggerProps) {
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref);
  const Tag = as as "div";
  const Item = as === "ul" || as === "ol" ? "li" : "div";
  const vars = {
    "--stagger-step": `${step}ms`,
    "--stagger-delay": `${delay}ms`,
    ...(y === undefined ? {} : { "--reveal-y": `${y}px` }),
  } as CSSProperties;
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={className}
      style={vars}
      data-stagger=""
      data-visible={visible ? "" : undefined}
    >
      {Children.toArray(children).map((child, index) => (
        <Item
          key={index}
          data-stagger-item=""
          className={cn(itemClassName)}
          style={{ "--i": index } as CSSProperties}
        >
          {child}
        </Item>
      ))}
    </Tag>
  );
}
