import type { ReactNode } from "react";
import { RevealText } from "@/components/motion/reveal-text";

/**
 * Screen title in the brand's display style: a mono eyebrow, a large tight heading whose letters rise in,
 * and a calm lede.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  /** Short mono label above the title ("Ledger · signature", "Enclave · audit"...). */
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow !== undefined && <div className="mb-3 mono-label text-muted-foreground">{eyebrow}</div>}
        <RevealText as="h1" text={title} className="text-page-title" />
        {description !== undefined && (
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}

/** Section title inside a page: mono, uppercase, with a hairline running to the edge. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="shrink-0 mono-label text-muted-foreground">{children}</h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {aside}
    </div>
  );
}

/** Calm empty state for lists. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed bg-surface/50 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full border bg-card text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <div className="mt-4 text-[15px] font-semibold tracking-[-0.02em]">{title}</div>
      {children !== undefined && (
        <div className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">{children}</div>
      )}
    </div>
  );
}
