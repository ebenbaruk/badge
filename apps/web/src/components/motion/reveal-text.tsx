"use client";

import { useMemo, useRef } from "react";
import { splitForReveal } from "@/lib/motion";
import { useInView } from "./use-in-view";

export interface RevealTextProps {
  /** Plain text of the heading (split into letters; rich content is not supported). */
  text: string;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span";
  className?: string;
  id?: string;
}

/**
 * Heading whose letters rise out of a blur one after another when it scrolls into view.
 * Screen readers get the whole string once (`sr-only`); the split letters are `aria-hidden`.
 */
export function RevealText({ text, as = "h2", className, id }: RevealTextProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const visible = useInView(ref);
  const words = useMemo(() => splitForReveal(text), [text]);
  const Tag = as;
  return (
    <Tag ref={ref} id={id} className={className} data-reveal-text="" data-visible={visible ? "" : undefined}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word) => (
          <span key={word.letters[0]?.index} className="reveal-word">
            <span className="inline-block whitespace-nowrap">
              {word.letters.map((letter) => (
                <span
                  key={letter.index}
                  className="reveal-letter"
                  style={{ "--i": letter.index } as React.CSSProperties}
                >
                  {letter.char}
                </span>
              ))}
            </span>
            {word.trailing}
          </span>
        ))}
      </span>
    </Tag>
  );
}
