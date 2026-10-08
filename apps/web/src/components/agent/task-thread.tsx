import type { Route } from "next";
import { ArrowUpRight, Ban, Bot, Hourglass, Skull, Sparkles } from "lucide-react";
import Link from "next/link";
import { EmployeeAvatar } from "@/components/shell/employee-avatar";
import { ProvenanceBadge } from "@/components/provenance";
import { RiskFindings } from "@/components/risk-findings";
import { PulseDot } from "@/components/motion/pulse-dot";
import { Button } from "@/components/ui/button";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { formatLength, formatTime, reasonForThirdParty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BlockedExcerptView, ContextOwner, TaskStatus, TaskView } from "@/server/enclave/types";
import { TaskTimeline } from "./task-timeline";
import { TokenCard } from "./token-card";

const STATUS: Record<TaskStatus, { label: string; className: string }> = {
  waiting_consent: {
    label: "Awaiting consent",
    className: "border-warning/35 bg-warning/10 text-warning",
  },
  ready: { label: "Brief ready", className: "border-success/35 bg-success/10 text-success" },
  refused: { label: "Refused", className: "border-danger/35 bg-danger/10 text-danger" },
};

const BLOCKED_KIND_LABEL: Record<BlockedExcerptView["kind"], string> = {
  rule: "Blocked",
  classifier: "Not relevant",
  rejected: "Rejected",
  revoked: "Revoked",
  expired: "Expired",
};

function ownerLabel(owner: ContextOwner): string {
  return owner === "company" ? "Acme (company)" : EMPLOYEES[owner].name;
}

/**
 * One callout per owner: an owner reviews all of a task's excerpts in their inbox, one Ledger signature each.
 * The discovery line makes the core idea visible: the memory itself surfaced a colleague's context the requester
 * did not know about. It is left out for a compromised agent, whose request did aim at that colleague.
 */
function PendingCallout({ task, requester }: { task: TaskView; requester: EmployeeId }) {
  const owners = [...new Set(task.pending.map((p) => p.owner))];
  return (
    <div className="space-y-2">
      {owners.map((owner) => {
        const excerpts = task.pending.filter((p) => p.owner === owner);
        // The enclave words rule reasons for the owner ("your context"); the requester reads them about the owner.
        const findings = excerpts
          .flatMap((p) => p.findings)
          .map((f) => ({ ...f, message: reasonForThirdParty(f.message, EMPLOYEES[owner].name) }));
        const total = excerpts.reduce((sum, p) => sum + p.length, 0);
        return (
          <div key={owner} className="app-enter rounded-2xl border border-warning/35 bg-warning/6 p-4">
            {!task.trapped && (
              <p className="mb-3 flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" />
                <span>
                  Badge found relevant context in {EMPLOYEES[owner].name}&apos;s memory on its own;{" "}
                  {EMPLOYEES[requester].firstName} never asked for it. It stays sealed in the enclave until{" "}
                  {EMPLOYEES[owner].firstName} approves on their Ledger.
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <EmployeeAvatar employee={owner} size="sm" />
              {/* A floor width so the button wraps below instead of squeezing the name into a column. */}
              <div className="min-w-[12rem] flex-1">
                <div className="text-[13px] font-semibold">
                  <PulseDot tone="live" className="mr-2 align-middle" />
                  Waiting for {EMPLOYEES[owner].name}
                  <span className="ml-1.5 font-normal text-muted-foreground">· on their Ledger</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {excerpts.length === 1
                    ? `${excerpts[0]?.label ?? ""} · ${formatLength(total)}`
                    : `${excerpts.length} excerpts · ${formatLength(total)}`}
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/${owner}/consents` as Route}>
                  Open {EMPLOYEES[owner].firstName}&apos;s inbox
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
      <div className="app-enter overflow-hidden rounded-2xl border bg-background">
        <div className="flex items-center gap-2.5 border-b bg-brand-deep px-5 py-4 text-paper">
          <Sparkles className="size-4 shrink-0 text-signal-hover" />
          <span className="font-heading text-[17px] leading-snug font-medium tracking-[-0.035em]">
            {brief.title}
          </span>
        </div>
        <div className="p-5">
          <ul className="space-y-2.5">
            {brief.bullets.map((bullet) => (
              <li key={bullet.text} className="flex gap-2.5 text-[13.5px] leading-relaxed">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" />
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
            <p className="mt-5 rounded-xl border border-brand/20 bg-brand/8 px-4 py-3 text-[13px] leading-relaxed">
              <span className="font-semibold text-brand">Recommendation. </span>
              {brief.recommendation}
            </p>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2.5 mono-label text-[10px] text-muted-foreground">Sources and permissions</div>
        <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
          {task.allowed.map((source, index) => (
            <li
              key={source.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs transition-colors hover:bg-surface/70"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-brand/40 font-mono text-[10.5px] font-semibold text-brand">
                {index + 1}
              </span>
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
      <div className="mb-2.5 mono-label text-[10px] text-muted-foreground">Kept in the enclave</div>
      <ul className="divide-y divide-dashed overflow-hidden rounded-2xl border border-dashed bg-surface/50">
        {blocked.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-xs"
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
                "rounded-pill border px-2 py-0.5 mono-chip",
                item.kind === "classifier" ? "text-muted-foreground" : "border-danger/35 text-danger",
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
    <article className="app-enter space-y-4">
      <div className="flex items-start gap-3">
        <EmployeeAvatar employee={requester} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{EMPLOYEES[requester].firstName}</span>
            <time className="mono-label text-[10px]">{formatTime(task.createdAt)}</time>
          </div>
          <p className="mt-1 w-fit rounded-2xl rounded-tl-xs bg-surface-strong px-4 py-2.5 text-[15px] leading-snug text-surface-strong-foreground">
            {task.task}
          </p>
        </div>
      </div>

      <div
        className={cn("ml-11 overflow-hidden rounded-3xl border bg-card", task.trapped && "border-danger/40")}
      >
        <div className="flex flex-wrap items-center gap-2 border-b bg-surface/60 px-5 py-3">
          <span className="flex size-7 items-center justify-center rounded-full bg-card ring-1 ring-border">
            <Bot className="size-4 text-muted-foreground" />
          </span>
          <span className="text-[13px] font-semibold">{EMPLOYEES[requester].firstName}&apos;s agent</span>
          {task.trapped && (
            <span className="inline-flex items-center gap-1 rounded-pill border border-danger/35 bg-danger/10 px-2.5 py-0.5 text-[11px] font-semibold text-danger">
              <Skull className="size-3" />
              Compromised agent (simulation)
            </span>
          )}
          <span
            className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground"
            title={task.taskLabel}
          >
            task &ldquo;{task.taskLabel}&rdquo;
          </span>
          <span
            className={cn(
              "ml-auto inline-flex shrink-0 items-center rounded-pill border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors duration-500 ease-out-soft",
              status.className,
            )}
          >
            {task.status === "waiting_consent" && <Hourglass className="mr-1 inline size-3" />}
            {status.label}
          </span>
        </div>
        <div className="grid gap-8 p-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:p-6">
          <TaskTimeline steps={task.steps} />
          <div className="min-w-0 space-y-4">
            {task.pending.length > 0 && <PendingCallout task={task} requester={requester} />}
            {task.status === "refused" && (
              <div className="app-enter rounded-2xl border border-danger/35 bg-danger/6 p-5 text-[13px]">
                <div className="font-heading text-[17px] font-medium tracking-[-0.035em] text-danger">
                  Nothing left the enclave.
                </div>
                <p className="mt-1 text-muted-foreground">
                  The agent&apos;s request was refused: no excerpt was injected into the model.
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
