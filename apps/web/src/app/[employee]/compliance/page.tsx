import { BadgeCheck, Link2, Link2Off, ScrollText, ShieldAlert, ShieldX, VenetianMask } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RevealButton } from "@/components/compliance/reveal-button";
import { CopyableHash } from "@/components/copyable-hash";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { EmptyState, PageHeader, SectionTitle } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DESK_NAMES, EMPLOYEES, isDeskId, isEmployeeId } from "@/lib/directory";
import { formatDateTime, formatTime, plural, reasonForThirdParty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { enclave, type RuleAlertView } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";

export const metadata: Metadata = { title: "Compliance" };

/** Long hashes and decimals (nullifiers, roots) are cut in the table; the full value is in the tooltip. */
const MAX_DATA_VALUE_LENGTH = 16;
const SHORT_DATA_VALUE_LENGTH = 10;
const SEALED_SIGNER_KEY = "sealedSigner";

const TYPE_TONE: Record<string, string> = {
  "rule.warn": "bg-danger/12 text-danger",
  "rule.block": "bg-danger/12 text-danger",
  "consent.approved": "bg-success/12 text-success",
  "grant.reused": "bg-success/12 text-success",
  "policy.used": "bg-brand/12 text-brand",
  "policy.created": "bg-brand/12 text-brand",
  "consent.rejected": "bg-warning/14 text-warning",
  revoke: "bg-warning/14 text-warning",
  "desk.share": "bg-violet/12 text-violet dark:text-lavender",
  "compliance.reveal": "bg-violet/12 text-violet dark:text-lavender",
};

function actorLabel(actor: string): string {
  if (isEmployeeId(actor)) return EMPLOYEES[actor].name;
  if (actor === "anonymous") return "Anonymous desk member";
  if (actor === "enclave") return "Enclave";
  const desk = actor.startsWith("desk:") ? actor.slice("desk:".length) : null;
  if (desk !== null) return `Desk ${isDeskId(desk) ? DESK_NAMES[desk] : desk} (anonymous)`;
  return actor;
}

/** Compact `key=value` rendering of the entry data (hashes and labels only: never excerpt text). */
function DataCell({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex max-w-80 flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10.5px] text-muted-foreground">
      {entries.map(([key, value]) => {
        // Sealed boxes are ciphertext for the compliance key: meaningless to read, opened with "Reveal identity".
        const text =
          key === SEALED_SIGNER_KEY ? "sealed" : typeof value === "string" ? value : JSON.stringify(value);
        return (
          <span key={key} className="truncate" title={text}>
            {key}={text.length > MAX_DATA_VALUE_LENGTH ? `${text.slice(0, SHORT_DATA_VALUE_LENGTH)}…` : text}
          </span>
        );
      })}
    </div>
  );
}

/** Pastel art tiles of the reference: fixed colours in both themes, with their own ink. */
const STAT_TILES = {
  periwinkle: "bg-periwinkle text-periwinkle-ink",
  peach: "bg-peach text-peach-ink",
  lavender: "bg-lavender text-lavender-ink",
} as const;

function Stat({
  icon,
  label,
  value,
  tile,
  alarm = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tile: keyof typeof STAT_TILES;
  /** Problem state: the value turns to the fixed alarm red, readable on every pastel tile. */
  alarm?: boolean;
}) {
  return (
    <div className={cn("app-enter app-lift flex min-h-36 flex-col rounded-[18px] p-5", STAT_TILES[tile])}>
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <span className="flex size-7 items-center justify-center rounded-full bg-white/45 ring-1 ring-white/50">
          {icon}
        </span>
        {label}
      </div>
      <div
        className={cn(
          "mt-auto pt-5 font-heading text-[32px] leading-none font-medium tracking-display",
          alarm && "text-bad",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** One request against one owner's context, however many of its excerpts the rules flagged. */
function AlertRow({ alert }: { alert: RuleAlertView }) {
  const block = alert.level === "block";
  const { owner, requester } = alert;
  return (
    <li className="app-enter flex items-start gap-3 px-5 py-4 text-xs">
      {block ? (
        <ShieldX className="size-4 shrink-0 text-danger" />
      ) : (
        <ShieldAlert className="size-4 shrink-0 text-danger" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="rounded-pill border border-danger/35 bg-danger/8 px-2 py-0.5 mono-chip text-danger">
            {block ? "Blocked" : "Flagged"}
          </span>
          <span className="text-muted-foreground">
            {requester === null ? "An agent's request" : `${EMPLOYEES[requester].name}'s agent`} →{" "}
            {owner === null ? "?" : `${EMPLOYEES[owner].name}'s`} context
            {alert.excerpts > 1 && ` · ${plural(alert.excerpts, "excerpt")}`}
          </span>
          <time className="ml-auto mono-label text-[10px] text-muted-foreground">
            {formatDateTime(alert.ts)}
          </time>
        </div>
        {alert.reasons.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-danger">
            {alert.reasons.map((reason) => (
              <li key={`${reason.code}-${reason.message ?? ""}`} title={reason.code}>
                {reason.message === undefined
                  ? reason.code
                  : reasonForThirdParty(reason.message, owner === null ? null : EMPLOYEES[owner].name)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export default async function CompliancePage({ params }: { params: Promise<{ employee: string }> }) {
  const viewer = await employeeFromParams(params);
  if (viewer.role !== "compliance") notFound();
  const audit = await load(() => enclave().audit(viewer.id));
  if (!audit.ok) return <EnclaveUnavailable failure={audit} employee={viewer.id} />;
  const { entries, chain, alerts, sealed } = audit.data;
  // A chain that verifies from genesis but does not extend the head already seen was truncated or rolled back.
  const trusted = chain.ok && chain.anchorProblem === undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Compliance"
        eyebrow="Enclave · hash-chained log"
        description="The enclave's audit log: each entry is chained to the previous one by its SHA-256 fingerprint and holds only fingerprints, never the text of an excerpt."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={trusted ? <Link2 className="size-3.5" /> : <Link2Off className="size-3.5" />}
          label="Chain integrity"
          tile="periwinkle"
          alarm={!trusted}
          value={
            <span className="block">
              {!chain.ok
                ? `Broken at entry ${chain.brokenAt}`
                : chain.anchorProblem !== undefined
                  ? "Untrusted"
                  : "Verified"}
              {/* The anchor problem is a sentence: it goes on the small line, the tile keeps a short verdict. */}
              <span className="mt-2 block font-sans text-xs font-medium tracking-normal opacity-75">
                {chain.ok && chain.anchorProblem !== undefined ? `${chain.anchorProblem} · ` : ""}
                {chain.length} entries
              </span>
            </span>
          }
        />
        <Stat
          icon={<ShieldAlert className="size-3.5" />}
          label="Rule alerts"
          tile="peach"
          alarm={alerts.length > 0}
          value={alerts.length}
        />
        <Stat
          icon={<VenetianMask className="size-3.5" />}
          label="Sealed anonymous shares"
          tile="lavender"
          value={sealed.length}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-pill border bg-card px-4 py-2 text-[11px] text-muted-foreground">
        Chain head <CopyableHash value={chain.headHash} />
        {chain.headSigner !== undefined && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-success">
              <BadgeCheck className="size-3" />
              signed by the attested enclave
            </span>
            · audit key <CopyableHash value={chain.headSigner} />
          </span>
        )}
      </div>

      <section className="mt-10">
        <SectionTitle>Alerts</SectionTitle>
        {alerts.length === 0 ? (
          <EmptyState icon={<ShieldAlert />} title="No alerts">
            The mass-extraction rules (length, share of context, number of people, frequency) have flagged
            nothing.
          </EmptyState>
        ) : (
          <ul className="divide-y overflow-hidden rounded-3xl border border-danger/30 bg-card">
            {[...alerts].reverse().map((alert) => (
              <AlertRow key={alert.seq} alert={alert} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <SectionTitle>Sealed identities of anonymous shares</SectionTitle>
        {sealed.length === 0 ? (
          <EmptyState icon={<VenetianMask />} title="No anonymous shares" />
        ) : (
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {sealed.map((item) => (
              <li
                key={item.seq}
                className="app-enter flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-xs"
              >
                <span className="font-mono text-muted-foreground">#{item.seq}</span>
                <span className="font-semibold">Desk {DESK_NAMES[item.sourceDesk]}</span>
                <span className="text-muted-foreground">{item.label}</span>
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  sealed <CopyableHash value={item.sealed} />
                </span>
                <span className="ml-auto">
                  {item.revealed === undefined ? (
                    <RevealButton
                      employee={viewer.id}
                      seq={item.seq}
                      sourceDesk={DESK_NAMES[item.sourceDesk]}
                    />
                  ) : (
                    <span className="inline-flex animate-gallery-in items-center rounded-pill bg-lavender px-3 py-1 font-semibold text-lavender-ink">
                      {item.revealed.employee === undefined
                        ? "Identity revealed"
                        : EMPLOYEES[item.revealed.employee].name}{" "}
                      · revealed {formatDateTime(item.revealed.revealedAt)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <SectionTitle>Audit log</SectionTitle>
        {entries.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="Empty log" />
        ) : (
          <div className="overflow-hidden rounded-3xl border bg-card">
            <Table>
              <TableHeader className="bg-surface/60 [&_th]:mono-label [&_th]:text-[10px] [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="pl-4">#</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="pr-4">Fingerprint / prev.</TableHead>
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
                          "rounded-pill px-2.5 py-1 font-mono text-[10.5px] font-semibold",
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
