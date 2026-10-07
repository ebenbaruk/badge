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
    label: "Enclave attestée",
    className: "border-success/30 bg-success/10 text-success",
    iconClass: "text-success",
    Icon: ShieldCheck,
  },
  simulated: {
    label: "TEE simulé",
    className: "border-warning/35 bg-warning/10 text-warning",
    iconClass: "text-warning",
    Icon: ShieldAlert,
  },
  failed: {
    label: "Attestation indisponible",
    className: "border-danger/30 bg-danger/10 text-danger",
    iconClass: "text-danger",
    Icon: ShieldX,
  },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
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
            "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors hover:brightness-110",
            className,
          )}
        >
          <Icon className="size-3.5" />
          {label}
          {attestation !== null && (
            <span className="hidden font-mono text-[11px] font-normal opacity-80 lg:inline">
              {attestation.measurement.slice(0, 10)}…{attestation.measurement.slice(-4)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px]">
        <div className="mb-2 flex items-center gap-2">
          <Icon className={cn("size-4", iconClass)} />
          <div className="text-sm font-medium">{label}</div>
        </div>
        {attestation === null ? (
          <p className="text-xs text-muted-foreground">{failure ?? "L'enclave n'a pas répondu."}</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {attestation.mode === "tdx"
                ? "Quote Intel TDX vérifiée (DCAP), journal d'événements rejoué : l'enclave exécute exactement ce code."
                : "Simulateur dstack : la quote et le journal d'événements sont vérifiés de la même façon, mais sans aucune garantie matérielle."}
            </p>
            <div className="divide-y">
              <Row label="Mesure (compose hash)">
                <CopyableHash value={attestation.measurement} full />
              </Row>
              <Row label="Statut TCB">
                <span className="font-mono">{attestation.tcbStatus}</span>
              </Row>
              <Row label="App ID">
                <CopyableHash value={attestation.appId} full />
              </Row>
              <Row label="Mode">{attestation.mode === "tdx" ? "Intel TDX (Phala dstack)" : "Simulé"}</Row>
              {attestation.keyProvider !== undefined && (
                <Row label="Fournisseur de clés">
                  <span className="font-mono">{attestation.keyProvider}</span>
                </Row>
              )}
              <Row label="Vérifiée le">{formatDateTime(attestation.checkedAt)}</Row>
            </div>
            {attestation.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-md bg-muted/60 p-2.5 text-[11px] text-muted-foreground">
                {attestation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Chaque message signé sur un Ledger porte cette mesure : un accord ne vaut que pour cette
              enclave.
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
