import { cn } from "@/lib/utils";

/** Badge mark: a shield-shaped badge with a key slot, drawn inline so it follows the theme colours. */
export function BadgeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path
        d="M16 6.5 24 9.5v6.2c0 5-3.4 8.6-8 9.8-4.6-1.2-8-4.8-8-9.8V9.5l8-3Z"
        className="fill-brand-foreground/95"
      />
      <circle cx="16" cy="14.5" r="2.4" className="fill-brand" />
      <rect x="15" y="15.5" width="2" height="5" rx="1" className="fill-brand" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <BadgeMark />
      <div className="leading-none">
        <div className="text-[15px] font-semibold tracking-tight">Badge</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">Acme · mémoire confidentielle</div>
      </div>
    </div>
  );
}
