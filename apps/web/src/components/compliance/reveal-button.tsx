"use client";

import { EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const reveal = async (): Promise<void> => {
    setBusy(true);
    const result = await revealDeskShare({ employee, seq });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const who = result.data.revealed?.employee;
    toast.success(
      who === undefined ? "Identité levée." : `Identité levée : ${EMPLOYEES[who].name}. Levée journalisée.`,
    );
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <EyeOff />
          Lever l&apos;anonymat
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
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          Démo : déchiffrement simulé. En production, la clé de déchiffrement est dérivée d&apos;une signature
          sur le Ledger de la responsable conformité, et le déchiffrement a lieu dans son navigateur.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Annuler</Button>
          </DialogClose>
          <Button onClick={() => void reveal()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Lever l&apos;anonymat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
