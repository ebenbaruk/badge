"use client";

import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CopyableHash } from "@/components/copyable-hash";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AttestationView } from "@/server/enclave/types";

type Tone = "attested" | "simulated" | "failed";

function toneOf(attestation: AttestationView | null): Tone {
  if (attestation === null || !attestation.verified) return "failed";
  return attestation.mode === "tdx" ? "attested" : "simulated";
}

const TONE_STYLES: Record<
  Tone,
  { label: string; className: string; iconClass: string; Icon: typeof ShieldCheck }
> = {
  attested: {
    label: "Attested enclave",
    className: "border-success/30 bg-success/10 text-success",
    iconClass: "text-success",
    Icon: ShieldCheck,
  },
  simulated: {
    label: "Simulated TEE",
    className: "border-warning/35 bg-warning/10 text-warning",
    iconClass: "text-warning",
    Icon: ShieldAlert,
  },
  failed: {
    label: "Attestation unavailable",
    className: "border-danger/30 bg-danger/10 text-danger",
    iconClass: "text-danger",
    Icon: ShieldX,
  },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3 py-2 text-xs">
      <span className="pt-px mono-label text-[10px] text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/**
 * Attestation status of the enclave, with the live measurement. Green only for a verified Intel TDX quote;
 * the simulator (or the mock) is always shown amber, never as a real TEE.
 */
export function AttestationBadge({
  attestation,
  failure,
}: {
  attestation: AttestationView | null;
  failure?: string;
}) {
  const tone = toneOf(attestation);
  const { label, className, iconClass, Icon } = TONE_STYLES[tone];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-pill border px-3.5 text-xs font-semibold transition-[filter,translate] duration-300 ease-out-soft hover:-translate-y-px hover:brightness-110 aria-expanded:translate-y-0",
            className,
          )}
        >
          {/* The halo breathes only while the enclave answers: a failed attestation stays still. */}
          {tone === "failed" ? <Icon className="size-3.5" /> : <span className="app-halo-dot" aria-hidden />}
          {label}
          {attestation !== null && (
            <span className="hidden font-mono text-[11px] font-normal opacity-75 lg:inline">
              {attestation.measurement.slice(0, 10)}…{attestation.measurement.slice(-4)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] rounded-2xl p-5">
        <div className="mono-label text-muted-foreground">Enclave attestation</div>
        <div className="mt-2 mb-3 flex items-center gap-2">
          <span
            className={cn("flex size-7 items-center justify-center rounded-full bg-current/10", iconClass)}
          >
            <Icon className="size-4" />
          </span>
          <div className="font-heading text-lg leading-tight font-medium tracking-[-0.04em]">{label}</div>
        </div>
        {attestation === null ? (
          <p className="text-xs text-muted-foreground">{failure ?? "The enclave did not respond."}</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {attestation.mode === "tdx"
                ? "Intel TDX quote verified (DCAP), event log replayed: the enclave runs exactly this code."
                : "dstack simulator: the quote and event log are verified the same way, but with no hardware guarantee."}
            </p>
            <div className="divide-y">
              <Row label="Measurement (compose hash)">
                <CopyableHash value={attestation.measurement} full />
              </Row>
              <Row label="TCB status">
                <span className="font-mono">{attestation.tcbStatus}</span>
              </Row>
              <Row label="App ID">
                <CopyableHash value={attestation.appId} full />
              </Row>
              <Row label="Mode">{attestation.mode === "tdx" ? "Intel TDX (Phala dstack)" : "Simulated"}</Row>
              {attestation.keyProvider !== undefined && (
                <Row label="Key provider">
                  <span className="font-mono">{attestation.keyProvider}</span>
                </Row>
              )}
              <Row label="Verified at">{formatDateTime(attestation.checkedAt)}</Row>
            </div>
            {attestation.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-md bg-surface p-3 text-[11px] text-muted-foreground">
                {attestation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Every message signed on a Ledger carries this measurement: a consent is only valid for this
              enclave.
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
