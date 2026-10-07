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
    "Prépare-moi le brief du rendez-vous de demain avec le client Orion",
    "Où en est le prospect Helios Froid ?",
  ],
  bob: ["Résume les conditions tarifaires en vigueur", "Quelles sont les actualités d'Acme ?"],
  chloe: ["Quel est le modèle de contrat-cadre en vigueur ?", "Résume la politique tarifaire"],
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
        "rounded-xl border bg-card shadow-xs transition-colors focus-within:border-ring/60",
        compromised && "border-danger/40 focus-within:border-danger/60",
      )}
    >
      <Textarea
        value={task}
        onChange={(event) => setTask(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Demandez quelque chose à votre agent…"
        aria-label="Tâche pour l'agent"
        className="min-h-20 resize-none border-0 bg-transparent px-4 pt-3.5 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center gap-2 px-3 pt-1 pb-3">
        {SUGGESTIONS[employee].map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => setTask(suggestion)}
            className="max-w-full truncate rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                  Agent compromis
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Simule une injection de prompt : l&apos;agent demande tout le contexte de {targetName} au lieu
              de chercher pour la tâche.
            </TooltipContent>
          </Tooltip>
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            aria-label="Envoyer"
            disabled={pending || task.trim().length === 0}
          >
            {pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </form>
  );
}
