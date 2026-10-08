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
 * "Lever l'anonymat": a deliberate, logged act. The confirmation states that the reveal itself is recorded in the
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
      "Dériver ma clé de conformité (lever l'anonymat)",
      () => revealDeskShare({ employee, seq }),
      {
        success: (sealed) => {
          const who = sealed.revealed?.employee;
          return who === undefined
            ? "Identité levée. Levée journalisée."
            : `Identité levée : ${EMPLOYEES[who].name}. Levée journalisée.`;
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
          {busy ? "Vérifiez sur votre Ledger…" : "Lever l'anonymat"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lever l&apos;anonymat de ce partage ?</DialogTitle>
          <DialogDescription>
            L&apos;identité du membre du desk {sourceDesk} qui a partagé l&apos;extrait (entrée n° {seq}) est
            scellée pour la conformité. La levée est définitive et inscrite au journal d&apos;audit chaîné.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-2xl border bg-surface px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Votre Ledger va signer le message de dérivation de votre clé de conformité. La clé n&apos;existe que
          le temps du déchiffrement, de votre côté : l&apos;enclave ne voit jamais l&apos;identité, seulement
          l&apos;avis de levée.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Annuler</Button>
          </DialogClose>
          <Button variant="night" onClick={() => void reveal()} disabled={busy}>
            Signer sur mon Ledger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
