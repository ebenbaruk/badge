import type { Route } from "next";
import { ArrowUpRight, Ban, Bot, Hourglass, Skull, Sparkles } from "lucide-react";
import Link from "next/link";
import { EmployeeAvatar } from "@/components/shell/employee-avatar";
import { ProvenanceBadge } from "@/components/provenance";
import { RiskFindings } from "@/components/risk-findings";
import { Button } from "@/components/ui/button";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { formatLength, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BlockedExcerptView, ContextOwner, TaskStatus, TaskView } from "@/server/enclave/types";
import { TaskTimeline } from "./task-timeline";
import { TokenCard } from "./token-card";

const STATUS: Record<TaskStatus, { label: string; className: string }> = {
  waiting_consent: { label: "En attente d'accord", className: "bg-warning/12 text-warning" },
  ready: { label: "Brief prêt", className: "bg-success/12 text-success" },
  refused: { label: "Refusé", className: "bg-danger/12 text-danger" },
};

const BLOCKED_KIND_LABEL: Record<BlockedExcerptView["kind"], string> = {
  rule: "Bloqué",
  classifier: "Écarté",
  rejected: "Refusé",
  revoked: "Révoqué",
  expired: "Expiré",
};

function ownerLabel(owner: ContextOwner): string {
  return owner === "company" ? "Acme (global)" : EMPLOYEES[owner].name;
}

/** One callout per owner: an owner reviews all of a task's excerpts in their inbox, one Ledger signature each. */
function PendingCallout({ task }: { task: TaskView }) {
  const owners = [...new Set(task.pending.map((p) => p.owner))];
  return (
    <div className="space-y-2">
      {owners.map((owner) => {
        const excerpts = task.pending.filter((p) => p.owner === owner);
        const findings = excerpts.flatMap((p) => p.findings);
        const total = excerpts.reduce((sum, p) => sum + p.length, 0);
        return (
          <div key={owner} className="rounded-lg border border-warning/30 bg-warning/6 p-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <EmployeeAvatar employee={owner} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">
                  En attente de {EMPLOYEES[owner].name}
                  <span className="ml-1.5 font-normal text-muted-foreground">· sur son Ledger</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {excerpts.length === 1
                    ? `${excerpts[0]?.label ?? ""} · ${formatLength(total)}`
                    : `${excerpts.length} extraits · ${formatLength(total)}`}
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/${owner}/consents` as Route}>
                  Ouvrir la boîte de {EMPLOYEES[owner].firstName}
                  <ArrowUpRight />
                </Link>
              </Button>
            </div>
            {findings.length > 0 && <RiskFindings findings={findings} className="mt-3" />}
          </div>
        );
      })}
    </div>
  );
}

function Brief({ task }: { task: TaskView }) {
  const brief = task.brief;
  if (brief === undefined) return null;
  const sourceIndex = new Map(task.allowed.map((source, index) => [source.id, index + 1]));
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-background p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-brand" />
          {brief.title}
        </div>
        <ul className="space-y-2.5">
          {brief.bullets.map((bullet) => (
            <li key={bullet.text} className="flex gap-2.5 text-[13.5px] leading-relaxed">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
              <span>
                {bullet.text}
                {bullet.sourceIds.map((id) => (
                  <sup key={id} className="ml-0.5 font-mono text-[10px] font-semibold text-brand">
                    [{sourceIndex.get(id)}]
                  </sup>
                ))}
              </span>
            </li>
          ))}
        </ul>
        {brief.recommendation !== undefined && (
          <p className="mt-4 rounded-md bg-brand/8 px-3.5 py-2.5 text-[13px] leading-relaxed">
            <span className="font-medium text-brand">Recommandation. </span>
            {brief.recommendation}
          </p>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Sources et autorisations</div>
        <ol className="divide-y rounded-lg border">
          {task.allowed.map((source, index) => (
            <li key={source.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-xs">
              <span className="w-5 font-mono font-semibold text-brand">[{index + 1}]</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{source.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {ownerLabel(source.owner)} · {formatLength(source.length)}
                </span>
              </span>
              <ProvenanceBadge allowedBy={source.allowedBy} />
            </li>
          ))}
        </ol>
      </div>
      {task.tokenStats !== undefined && <TokenCard stats={task.tokenStats} />}
    </div>
  );
}

function BlockedList({ blocked }: { blocked: readonly BlockedExcerptView[] }) {
  if (blocked.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-muted-foreground">Restés dans l&apos;enclave</div>
      <ul className="divide-y rounded-lg border border-dashed">
        {blocked.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3.5 py-2.5 text-xs"
          >
            <Ban
              className={cn(
                "mt-0.5 size-3.5",
                item.kind === "classifier" ? "text-muted-foreground" : "text-danger",
              )}
            />
            <div className="min-w-0 flex-1">
              <span className="font-medium">{item.label}</span>
              <span className="text-muted-foreground"> · {ownerLabel(item.owner)}</span>
              <p className="mt-0.5 text-muted-foreground">{item.reason}</p>
            </div>
            <span
              className={cn(
                "text-[11px] font-medium",
                item.kind === "classifier" ? "text-muted-foreground" : "text-danger",
              )}
            >
              {BLOCKED_KIND_LABEL[item.kind]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One request to the agent and its answer: steps in the enclave, pending consents, brief and sources. */
export function TaskThread({ task, requester }: { task: TaskView; requester: EmployeeId }) {
  const status = STATUS[task.status];
  return (
    <article className="space-y-3">
      <div className="flex items-start gap-3">
        <EmployeeAvatar employee={requester} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{EMPLOYEES[requester].firstName}</span>
            <time className="font-mono text-[10px]">{formatTime(task.createdAt)}</time>
          </div>
          <p className="mt-0.5 text-[14px]">{task.task}</p>
        </div>
      </div>

      <div className="ml-11 rounded-xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <Bot className="size-4 text-muted-foreground" />
          <span className="text-[13px] font-medium">Agent de {EMPLOYEES[requester].firstName}</span>
          {task.trapped && (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger/12 px-2 py-0.5 text-[11px] font-medium text-danger">
              <Skull className="size-3" />
              Agent compromis (simulation)
            </span>
          )}
          <span
            className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
            title={task.taskLabel}
          >
            tâche « {task.taskLabel} »
          </span>
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
              status.className,
            )}
          >
            {task.status === "waiting_consent" && <Hourglass className="mr-1 inline size-3" />}
            {status.label}
          </span>
        </div>
        <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <TaskTimeline steps={task.steps} />
          <div className="min-w-0 space-y-4">
            {task.pending.length > 0 && <PendingCallout task={task} />}
            {task.status === "refused" && (
              <div className="rounded-lg border border-danger/30 bg-danger/6 p-4 text-[13px]">
                <div className="font-medium text-danger">Rien n&apos;a quitté l&apos;enclave.</div>
                <p className="mt-1 text-muted-foreground">
                  La demande de l&apos;agent a été refusée : aucun extrait n&apos;a été injecté dans le
                  modèle.
                </p>
              </div>
            )}
            <Brief task={task} />
            <BlockedList blocked={task.blocked} />
          </div>
        </div>
      </div>
    </article>
  );
}
