import { ScanEye } from "lucide-react";
import type { DevicePreview } from "@/server/device-preview";

/** Table of the screens the Ledger will display: labels and values exactly as signed (ASCII). */
export function DevicePreviewCard({ preview }: { preview: DevicePreview }) {
  return (
    <div className="rounded-lg border bg-muted/25">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-[11px] font-medium text-muted-foreground">
        <ScanEye className="size-3.5" />
        Ce que votre Ledger affichera · <span className="text-foreground">{preview.intent}</span>
      </div>
      <dl className="divide-y">
        {preview.rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[120px_1fr] gap-3 px-3 py-1.5 text-[11px]">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={row.mono ? "font-mono break-all" : "break-words"}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
