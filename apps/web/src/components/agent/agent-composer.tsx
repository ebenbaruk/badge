"use client";

import { ArrowUp, Loader2, Skull } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EmployeeId } from "@/lib/directory";
import { cn } from "@/lib/utils";
import { startTask } from "@/server/actions/agent";

const SUGGESTIONS: Readonly<Record<EmployeeId, readonly string[]>> = {
  alice: [
    "Prepare the brief for tomorrow's meeting with client Orion",
    "Where do we stand with prospect Helios Froid?",
  ],
  bob: ["Summarize our current pricing terms", "What's new at Acme?"],
  chloe: ["Which master agreement template is current?", "Summarize the pricing policy"],
};

/** The employee's agent prompt, with the "compromised agent" switch used to demo the injection defence. */
export function AgentComposer({ employee, targetName }: { employee: EmployeeId; targetName: string }) {
  const router = useRouter();
  const [task, setTask] = useState("");
  const [compromised, setCompromised] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || pending) return;
    startTransition(async () => {
      const result = await startTask({ employee, task: trimmed, compromised });
      if (!result.ok) {
        toast.error(result.message, result.detail === undefined ? {} : { description: result.detail });
        return;
      }
      setTask("");
      router.refresh();
    });
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    submit(task);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(task);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        "workspace-composer rounded-3xl border bg-card shadow-nav transition-[border-color,box-shadow] duration-300 ease-out-soft focus-within:border-ring/60 focus-within:shadow-focus",
        compromised && "border-danger/45 bg-danger/[0.03] focus-within:border-danger/60",
      )}
    >
      <Textarea
        value={task}
        onChange={(event) => setTask(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask your agent anything…"
        aria-label="Task for the agent"
        className="min-h-24 resize-none rounded-3xl border-0 bg-transparent px-5 pt-4 text-[16px] font-medium shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-4">
        {SUGGESTIONS[employee].map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setTask(suggestion)}
            className="max-w-full truncate rounded-pill border bg-surface px-3.5 py-1.5 text-xs text-muted-foreground transition-[background-color,color,border-color] duration-300 ease-out-soft hover:border-foreground/30 hover:bg-card hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <Switch
                  id="compromised"
                  checked={compromised}
                  onCheckedChange={setCompromised}
                  className="data-[state=checked]:bg-danger"
                />
                <Label
                  htmlFor="compromised"
                  className={cn(
                    "gap-1 text-xs font-normal text-muted-foreground",
                    compromised && "text-danger",
                  )}
                >
                  <Skull className="size-3.5" />
                  Compromised agent
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Simulates a prompt injection: the agent asks for all of {targetName}&apos;s context instead of
              searching for the task.
            </TooltipContent>
          </Tooltip>
          <Button
            type="submit"
            size="icon-lg"
            variant="night"
            aria-label="Send"
            disabled={pending || task.trim().length === 0}
          >
            {pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </form>
  );
}
