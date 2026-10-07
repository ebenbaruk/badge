import { Link2, Link2Off, ScrollText, ShieldAlert, ShieldX, VenetianMask } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RevealButton } from "@/components/compliance/reveal-button";
import { CopyableHash } from "@/components/copyable-hash";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { EmptyState, PageHeader, SectionTitle } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DESK_NAMES, EMPLOYEES, isDeskId, isEmployeeId } from "@/lib/directory";
import { formatDateTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { enclave, type AuditEntryView } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";

export const metadata: Metadata = { title: "Conformité" };

/** Long hashes and decimals (nullifiers, roots) are cut in the table; the full value is in the tooltip. */
const MAX_DATA_VALUE_LENGTH = 16;
const SHORT_DATA_VALUE_LENGTH = 10;

const TYPE_TONE: Record<string, string> = {
  "rule.warn": "bg-danger/12 text-danger",
  "rule.block": "bg-danger/12 text-danger",
  "consent.approved": "bg-success/12 text-success",
  "grant.reused": "bg-success/12 text-success",
  "policy.used": "bg-brand/12 text-brand",
  "policy.created": "bg-brand/12 text-brand",
  "consent.rejected": "bg-warning/14 text-warning",
  revoke: "bg-warning/14 text-warning",
  "desk.share": "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  "compliance.reveal": "bg-violet-500/12 text-violet-600 dark:text-violet-300",
};

function actorLabel(actor: string): string {
  if (isEmployeeId(actor)) return EMPLOYEES[actor].name;
  const desk = actor.startsWith("desk:") ? actor.slice("desk:".length) : null;
  if (desk !== null) return `Desk ${isDeskId(desk) ? DESK_NAMES[desk] : desk} (anonyme)`;
  return actor;
}

/** Compact `key=value` rendering of the entry data (hashes and labels only: never excerpt text). */
function DataCell({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex max-w-80 flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10.5px] text-muted-foreground">
      {entries.map(([key, value]) => {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return (
          <span key={key} className="truncate" title={text}>
            {key}={text.length > MAX_DATA_VALUE_LENGTH ? `${text.slice(0, SHORT_DATA_VALUE_LENGTH)}…` : text}
          </span>
        );
      })}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("mt-2 text-lg font-semibold tracking-tight", tone)}>{value}</div>
    </div>
  );
}

function AlertRow({ entry }: { entry: AuditEntryView }) {
  const block = entry.type === "rule.block";
  const rules = Array.isArray(entry.data.rules) ? entry.data.rules.join(", ") : "";
  const owner =
    typeof entry.data.owner === "string" && isEmployeeId(entry.data.owner) ? entry.data.owner : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs">
      {block ? <ShieldX className="size-4 text-danger" /> : <ShieldAlert className="size-4 text-danger" />}
      <span className="font-medium">{block ? "Bloqué" : "Signalé"}</span>
      <span className="text-muted-foreground">
        Agent de {actorLabel(entry.actor)} → contexte de {owner === null ? "?" : EMPLOYEES[owner].name}
      </span>
      <span className="font-mono text-[11px] text-danger">{rules}</span>
      <time className="ml-auto text-muted-foreground">{formatDateTime(entry.ts)}</time>
    </li>
  );
}

export default async function CompliancePage({ params }: { params: Promise<{ employee: string }> }) {
  const viewer = await employeeFromParams(params);
  if (viewer.role !== "compliance") notFound();
  const audit = await load(() => enclave().audit(viewer.id));
  if (!audit.ok) return <EnclaveUnavailable failure={audit} />;
  const { entries, chain, alerts, sealed } = audit.data;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Conformité"
        description="Journal d'audit de l'enclave : chaque entrée est chaînée à la précédente par son empreinte SHA-256 et ne contient que des empreintes, jamais le texte des extraits."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={chain.ok ? <Link2 className="size-3.5" /> : <Link2Off className="size-3.5" />}
          label="Intégrité de la chaîne"
          tone={chain.ok ? "text-success" : "text-danger"}
          value={
            <span>
              {chain.ok ? "Vérifiée" : `Rompue à l'entrée ${chain.brokenAt}`}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{chain.length} entrées</span>
            </span>
          }
        />
        <Stat
          icon={<ShieldAlert className="size-3.5" />}
          label="Alertes des règles"
          tone={alerts.length > 0 ? "text-danger" : undefined}
          value={alerts.length}
        />
        <Stat
          icon={<VenetianMask className="size-3.5" />}
          label="Partages anonymes scellés"
          value={sealed.length}
        />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        Tête de chaîne <CopyableHash value={chain.headHash} />
      </div>

      <section className="mt-10">
        <SectionTitle>Alertes</SectionTitle>
        {alerts.length === 0 ? (
          <EmptyState icon={<ShieldAlert />} title="Aucune alerte">
            Les règles anti-aspiration (longueur, part du contexte, nombre de personnes, fréquence) n&apos;ont
            rien signalé.
          </EmptyState>
        ) : (
          <ul className="divide-y rounded-xl border border-danger/25 bg-card">
            {[...alerts].reverse().map((entry) => (
              <AlertRow key={entry.seq} entry={entry} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <SectionTitle>Identités scellées des partages anonymes</SectionTitle>
        {sealed.length === 0 ? (
          <EmptyState icon={<VenetianMask />} title="Aucun partage anonyme" />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {sealed.map((item) => (
              <li key={item.seq} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs">
                <span className="font-mono text-muted-foreground">#{item.seq}</span>
                <span className="font-medium">Desk {DESK_NAMES[item.sourceDesk]}</span>
                <span className="text-muted-foreground">{item.label}</span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  scellé <CopyableHash value={item.sealed} />
                </span>
                <span className="ml-auto">
                  {item.revealed === undefined ? (
                    <RevealButton
                      employee={viewer.id}
                      seq={item.seq}
                      sourceDesk={DESK_NAMES[item.sourceDesk]}
                    />
                  ) : (
                    <span className="font-medium text-violet-600 dark:text-violet-300">
                      {EMPLOYEES[item.revealed.employee].name} · levée le{" "}
                      {formatDateTime(item.revealed.revealedAt)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <SectionTitle>Journal d&apos;audit</SectionTitle>
        {entries.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="Journal vide" />
        ) : (
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">#</TableHead>
                  <TableHead>Heure</TableHead>
                  <TableHead>Événement</TableHead>
                  <TableHead>Acteur</TableHead>
                  <TableHead>Données</TableHead>
                  <TableHead className="pr-4">Empreinte / préc.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...entries].reverse().map((entry) => (
                  <TableRow key={entry.seq}>
                    <TableCell className="pl-4 font-mono text-muted-foreground tabular-nums">
                      {entry.seq}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {formatTime(entry.ts)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium",
                          TYPE_TONE[entry.type] ?? "bg-muted text-muted-foreground",
                        )}
                      >
                        {entry.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{actorLabel(entry.actor)}</TableCell>
                    <TableCell>
                      <DataCell data={entry.data} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex flex-col">
                        <CopyableHash value={entry.hash} />
                        <CopyableHash value={entry.prevHash} className="text-muted-foreground" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
