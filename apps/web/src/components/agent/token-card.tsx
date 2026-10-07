import { Gauge } from "lucide-react";
import { formatNumber, percentSaved } from "@/lib/format";
import type { TokenStats } from "@/server/enclave/types";

/** Selected context vs "inject everything": the cost and leakage argument in one glance. */
export function TokenCard({ stats }: { stats: TokenStats }) {
  const saved = percentSaved(stats.selectedTokens, stats.allContextTokens);
  const selectedWidth =
    stats.allContextTokens > 0 ? (stats.selectedTokens / stats.allContextTokens) * 100 : 0;
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Gauge className="size-3.5" />
          Contexte injecté dans le modèle
        </div>
        <div className="text-right">
          <span className="text-lg font-semibold text-success tabular-nums">{saved} %</span>
          <span className="ml-1 text-xs text-muted-foreground">économisés</span>
        </div>
      </div>
      <div className="mt-3 space-y-2.5">
        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span>Contexte sélectionné par Badge</span>
            <span className="font-mono tabular-nums">{formatNumber(stats.selectedTokens)} tokens</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${Math.max(selectedWidth, 2)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span>Tout injecter (global + tous les contextes personnels)</span>
            <span className="font-mono tabular-nums">{formatNumber(stats.allContextTokens)} tokens</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted-foreground/30" />
        </div>
      </div>
    </div>
  );
}
