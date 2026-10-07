import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuleFinding } from "@/server/enclave/types";

/** Findings of the enclave's deterministic rules, in red: the owner must see them before deciding. */
export function RiskFindings({
  findings,
  title = "Signalé par les règles de l'enclave",
  className,
}: {
  findings: readonly RuleFinding[];
  title?: string;
  className?: string;
}) {
  if (findings.length === 0) return null;
  return (
    <div className={cn("rounded-lg border border-danger/30 bg-danger/8 p-3", className)} role="alert">
      <div className="flex items-center gap-2 text-xs font-semibold text-danger">
        <ShieldAlert className="size-3.5" />
        {title}
      </div>
      <ul className="mt-1.5 space-y-1 pl-5.5 text-xs text-danger/90">
        {findings.map((finding) => (
          <li key={`${finding.rule}-${finding.message}`} className="list-disc">
            {finding.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
