"use client";

import { Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DESK_NAMES, type DeskId, type EmployeeId } from "@/lib/directory";
import { requestFromDesk } from "@/server/actions/desks";

const DEFAULT_QUESTION = "Onchain lending market trends and stablecoin rates";

/** Asks another desk across an exchange rule; the answer comes back without the sharer's identity. */
export function DeskRequestForm({
  employee,
  fromDesk,
  toDesk,
}: {
  employee: EmployeeId;
  fromDesk: DeskId;
  toDesk: DeskId;
}) {
  const router = useRouter();
  const [task, setTask] = useState(DEFAULT_QUESTION);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    startTransition(async () => {
      const result = await requestFromDesk({ employee, fromDesk, toDesk, task });
      if (!result.ok) {
        toast.error(result.message, result.detail === undefined ? {} : { description: result.detail });
        return;
      }
      toast.success(`Request sent to the ${DESK_NAMES[toDesk]} desk.`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Textarea
        value={task}
        onChange={(event) => setTask(event.target.value)}
        className="min-h-16 resize-none"
        aria-label={`Question for the ${DESK_NAMES[toDesk]} desk`}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || task.trim().length < 3}>
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
          Ask the {DESK_NAMES[toDesk]} desk
        </Button>
      </div>
    </form>
  );
}
