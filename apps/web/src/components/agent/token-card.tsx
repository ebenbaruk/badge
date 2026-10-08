import { Gauge } from "lucide-react";
import { formatNumber, percentSaved } from "@/lib/format";
import type { TokenStats } from "@/server/enclave/types";

/** Selected context vs "inject everything": the cost and leakage argument in one glance. */
export function TokenCard({ stats }: { stats: TokenStats }) {
  const saved = percentSaved(stats.selectedTokens, stats.allContextTokens);
  const selectedWidth =
    stats.allContextTokens > 0 ? (stats.selectedTokens / stats.allContextTokens) * 100 : 0;
  return (
    <div className="rounded-2xl border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 mono-label text-[10px] text-muted-foreground">
          <Gauge className="size-3.5" />
          Contexte injecté dans le modèle
        </div>
        <div className="text-right">
          <span className="font-heading text-[34px] leading-none font-medium tracking-display text-success tabular-nums">
            {saved} %
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">économisés</span>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span>Contexte sélectionné par Badge</span>
            <span className="font-mono tabular-nums">{formatNumber(stats.selectedTokens)} tokens</span>
          </div>
          <div className="h-2 overflow-hidden rounded-pill bg-card">
            <div
              className="app-fill h-full rounded-pill bg-gradient-to-r from-cobalt to-signal"
              style={{ width: `${Math.max(selectedWidth, 2)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span>Tout injecter (global + tous les contextes personnels)</span>
            <span className="font-mono tabular-nums">{formatNumber(stats.allContextTokens)} tokens</span>
          </div>
          <div className="h-2 rounded-pill bg-muted-foreground/25" />
        </div>
      </div>
    </div>
  );
}
