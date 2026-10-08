import { Building2, FileSignature, PenLine, Repeat, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AllowedBy } from "@/server/enclave/types";

const PROVENANCE: Record<AllowedBy, { label: string; className: string; Icon: typeof Building2 }> = {
  global: {
    label: "Company context",
    className: "border-border bg-muted/60 text-muted-foreground",
    Icon: Building2,
  },
  own: {
    label: "My context",
    className: "border-periwinkle/60 bg-periwinkle/20 text-brand-deep dark:text-periwinkle",
    Icon: User,
  },
  consent: {
    label: "Consent signed on Ledger",
    className: "border-success/30 bg-success/10 text-success",
    Icon: PenLine,
  },
  grant: {
    label: "Consent reused",
    className: "border-success/30 bg-success/10 text-success",
    Icon: Repeat,
  },
  policy: {
    label: "Standing agreement",
    className: "border-brand/30 bg-brand/10 text-brand",
    Icon: FileSignature,
  },
};

/** How an excerpt was allowed into a brief: the provenance a reviewer checks first. */
export function ProvenanceBadge({ allowedBy, className }: { allowedBy: AllowedBy; className?: string }) {
  const { label, className: tone, Icon } = PROVENANCE[allowedBy];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-pill border px-2.5 text-[11px] font-semibold whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}
