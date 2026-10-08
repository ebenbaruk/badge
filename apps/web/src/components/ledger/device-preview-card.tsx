import { ScanEye } from "lucide-react";
import type { DevicePreview } from "@/server/device-preview";

/** Table of the screens the Ledger will display: labels and values exactly as signed (ASCII). */
export function DevicePreviewCard({ preview }: { preview: DevicePreview }) {
  return (
    <div className="self-start overflow-hidden rounded-2xl border bg-surface">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-3">
        <ScanEye className="size-3.5 text-muted-foreground" />
        <span className="mono-label text-[10px] text-muted-foreground">What your Ledger will display</span>
        <span className="ml-auto rounded-pill bg-card px-2.5 py-1 mono-chip text-foreground">
          {preview.intent}
        </span>
      </div>
      {/* Mono values on a paper-white sheet: the closest the web gets to the Flex's e-ink screen. */}
      <dl className="divide-y bg-card/70">
        {preview.rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[120px_1fr] gap-3 px-4 py-2 text-[12px]">
            <dt className="pt-0.5 mono-label text-[10px] text-muted-foreground">{row.label}</dt>
            <dd
              className={
                row.mono ? "font-mono text-[11.5px] break-all" : "font-mono font-semibold break-words"
              }
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
