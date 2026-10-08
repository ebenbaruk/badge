import {
  Ban,
  CheckCircle2,
  FileText,
  FileSignature,
  Filter,
  Hourglass,
  Layers,
  PenLine,
  Search,
  ShieldAlert,
  ShieldX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskStep, TaskStepKind } from "@/server/enclave/types";

const STEP_STYLE: Record<TaskStepKind, { Icon: LucideIcon; tone: string }> = {
  search: { Icon: Search, tone: "text-muted-foreground" },
  candidates: { Icon: Layers, tone: "text-muted-foreground" },
  classified: { Icon: Filter, tone: "text-muted-foreground" },
  allowed: { Icon: CheckCircle2, tone: "text-success" },
  policy: { Icon: FileSignature, tone: "text-brand" },
  waiting_consent: { Icon: Hourglass, tone: "text-warning" },
  consent_received: { Icon: PenLine, tone: "text-success" },
  consent_rejected: { Icon: XCircle, tone: "text-danger" },
  rule_warn: { Icon: ShieldAlert, tone: "text-danger" },
  rule_block: { Icon: ShieldX, tone: "text-danger" },
  brief: { Icon: FileText, tone: "text-brand" },
  refused: { Icon: Ban, tone: "text-danger" },
};

/** The agent's steps inside the enclave, as a vertical timeline. */
export function TaskTimeline({ steps }: { steps: readonly TaskStep[] }) {
  return (
    <ol className="relative space-y-4">
      {steps.map((step, index) => {
        const { Icon, tone } = STEP_STYLE[step.kind];
        const last = index === steps.length - 1;
        return (
          // New steps rise in as the agent progresses (first render only, never on a refresh).
          <li
            key={`${step.kind}-${index}`}
            className="app-enter relative flex gap-3"
            style={{ "--i": index } as CSSProperties}
          >
            {!last && (
              <span aria-hidden className="absolute top-7 bottom-[-16px] left-[13px] w-px bg-border" />
            )}
            <span
              className={cn(
                "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-current/30 bg-card",
                tone,
                last && "ring-4 ring-current/10",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-semibold tracking-[-0.01em]">{step.title}</span>
                {step.at !== undefined && (
                  <time className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {formatTime(step.at)}
                  </time>
                )}
              </div>
              {step.detail !== undefined && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
