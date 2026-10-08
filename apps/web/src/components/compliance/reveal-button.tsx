"use client";

import { EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLedgerActivity } from "@/components/ledger/ledger-activity";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { revealDeskShare } from "@/server/actions/compliance";

/**
 * "Reveal identity": a deliberate, logged act. The confirmation states that the reveal itself is recorded in the
 * hash-chained audit log, which is what makes de-anonymisation accountable.
 */
export function RevealButton({
  employee,
  seq,
  sourceDesk,
}: {
  employee: EmployeeId;
  seq: number;
  sourceDesk: string;
}) {
  const router = useRouter();
  const { runOnLedger, activity } = useLedgerActivity();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reveal = async (): Promise<void> => {
    setBusy(true);
    // The dialog closes so the Ledger mirror (which shows the message to sign) stays in view.
    setOpen(false);
    await runOnLedger(
      "Derive my compliance key (reveal identity)",
      () => revealDeskShare({ employee, seq }),
      {
        success: (sealed) => {
          const who = sealed.revealed?.employee;
          return who === undefined
            ? "Identity revealed. The reveal is logged."
            : `Identity revealed: ${EMPLOYEES[who].name}. The reveal is logged.`;
        },
      },
    );
    setBusy(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy || activity !== null}>
          {busy ? <Loader2 className="animate-spin" /> : <EyeOff />}
          {busy ? "Check your Ledger…" : "Reveal identity"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reveal who made this share?</DialogTitle>
          <DialogDescription>
            The identity of the {sourceDesk} desk member who shared the excerpt (entry #{seq}) is sealed for
            compliance. Revealing it is final and is recorded in the hash-chained audit log.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-2xl border bg-surface px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Your Ledger will sign the message that derives your compliance key. The key only exists on your
          side, for the time it takes to decrypt: the enclave never sees the identity, only the notice that it
          was revealed.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="night" onClick={() => void reveal()} disabled={busy}>
            Sign on my Ledger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
