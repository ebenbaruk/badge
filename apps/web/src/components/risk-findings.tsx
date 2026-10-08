import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuleFinding } from "@/server/enclave/types";

/** Findings of the enclave's deterministic rules, in red: the owner must see them before deciding. */
export function RiskFindings({
  findings,
  title = "Flagged by enclave rules",
  className,
}: {
  findings: readonly RuleFinding[];
  title?: string;
  className?: string;
}) {
  if (findings.length === 0) return null;
  return (
    <div
      className={cn("animate-gallery-in rounded-2xl border border-danger/35 bg-danger/8 p-4", className)}
      role="alert"
    >
      <div className="flex items-center gap-2 mono-label text-danger">
        <ShieldAlert className="size-3.5" />
        {title}
      </div>
      <ul className="mt-2 space-y-1 pl-5.5 text-[13px] text-danger/90">
        {findings.map((finding) => (
          <li key={`${finding.rule}-${finding.message}`} className="list-disc">
            {finding.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
