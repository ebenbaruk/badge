import { cn } from "@/lib/utils";

export interface RollingTextProps {
  children: string;
  className?: string;
}

/**
 * Label that rolls up to a copy of itself when its closest `a`/`button` (or an element marked
 * `data-rolling-host`) is hovered or focused. Pure CSS: works in server components.
 */
export function RollingText({ children, className }: RollingTextProps) {
  return (
    <span className={cn("rolling", className)}>
      <span>{children}</span>
      <span aria-hidden="true">{children}</span>
    </span>
  );
}

/** "↗" that nudges up-right when its link or button is hovered. */
export function NudgeArrow({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("nudge-arrow", className)}>
      ↗
    </span>
  );
}

/** "+" that turns a quarter when its button is hovered (menu openers). */
export function SpinPlus({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("spin-plus", className)}>
      +
    </span>
  );
}
