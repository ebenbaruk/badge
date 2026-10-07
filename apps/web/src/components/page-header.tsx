import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}

/** Section title inside a page. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[13px] font-medium text-muted-foreground">{children}</h2>
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
    <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center">
      <div className="text-muted-foreground [&_svg]:size-5">{icon}</div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      {children !== undefined && (
        <div className="mt-1 max-w-sm text-xs text-muted-foreground">{children}</div>
      )}
    </div>
  );
}
