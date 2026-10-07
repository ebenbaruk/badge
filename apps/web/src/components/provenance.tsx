import { Building2, FileSignature, PenLine, Repeat, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AllowedBy } from "@/server/enclave/types";

const PROVENANCE: Record<AllowedBy, { label: string; className: string; Icon: typeof Building2 }> = {
  global: {
    label: "Contexte global",
    className: "border-border bg-muted/60 text-muted-foreground",
    Icon: Building2,
  },
  own: {
    label: "Mon contexte",
    className: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    Icon: User,
  },
  consent: {
    label: "Accord signé sur Ledger",
    className: "border-success/30 bg-success/10 text-success",
    Icon: PenLine,
  },
  grant: {
    label: "Accord réutilisé",
    className: "border-success/30 bg-success/10 text-success",
    Icon: Repeat,
  },
  policy: {
    label: "Accord permanent",
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
        "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
        tone,
        className,
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}
