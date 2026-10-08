import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { NudgeArrow, RollingText } from "@/components/motion/rolling-text";
import { cn } from "@/lib/utils";

/** Public repository of the project (the jury and visitors land there from the footer and the FAQ). */
export const GITHUB_URL = "https://github.com/ebenbaruk/badge";
/** Where every "Ouvrir la démo" call to action leads. */
export const DEMO_ROUTE: Route = "/demo";

/** Small left-hand label of the editorial `1fr 2.4fr` layout. */
export function Aside({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[12px] text-ink-muted-2 md:text-[14px]", className)}>{children}</p>;
}

/** Editorial two-column grid of the reference: tiny aside on the left, content on the right. */
export function EditorialGrid({
  aside,
  children,
  className,
}: {
  aside: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 md:grid-cols-[1fr_2.4fr] md:gap-[60px]", className)}>
      <Aside>{aside}</Aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Horizontal page gutter and max width shared by every section. */
export const SECTION_X = "mx-auto w-full max-w-[1700px] px-4 sm:px-6 lg:px-[26px]";

interface TextLinkProps {
  children: string;
  href: Route | `https://${string}` | `#${string}`;
  className?: string;
}

/** Underlined text link with a rolling label and a nudging arrow. External links open in a new tab. */
export function TextLink({ children, href, className }: TextLinkProps) {
  const classes = cn(
    "inline-flex items-center gap-[18px] border-b border-current py-2 text-[15px]",
    className,
  );
  const content = (
    <>
      <RollingText>{children}</RollingText>
      <NudgeArrow />
    </>
  );
  if (href.startsWith("https://")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {content}
        <span className="sr-only"> (nouvel onglet)</span>
      </a>
    );
  }
  if (href.startsWith("#")) {
    return (
      <a href={href} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href as Route} className={classes}>
      {content}
    </Link>
  );
}
