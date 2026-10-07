"use client";

import { Loader2, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EmployeeId } from "@/lib/directory";
import { useLedgerActivity } from "./ledger-activity";
import { LedgerMirror } from "./ledger-mirror";

function ActivityBanner() {
  const { activity } = useLedgerActivity();
  if (activity === null) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        Les accords se signent ici, sur le Ledger de l&apos;employé : ce que l&apos;écran affiche est
        exactement ce qui est signé.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-brand/30 bg-brand/8 p-3 text-xs">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Loader2 className="size-3.5 animate-spin text-brand" />
        Vérifiez sur le Ledger
      </div>
      <p className="mt-1 text-muted-foreground">{activity.label}</p>
      <p className="mt-1 text-muted-foreground">Faites défiler, puis maintenez « Hold to sign ».</p>
    </div>
  );
}

/**
 * The employee's Ledger, always at hand: a right-hand panel on wide screens, a dialog elsewhere (opened
 * automatically when a review starts).
 */
export function LedgerPanel({
  employee,
  deviceLabel,
  rehearsal,
}: {
  employee: EmployeeId;
  deviceLabel: string;
  rehearsal: boolean;
}) {
  const { activity } = useLedgerActivity();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1279px)").matches;
    if (activity !== null && narrow) setDialogOpen(true);
  }, [activity]);

  return (
    <>
      <aside className="sticky top-0 hidden h-svh w-[330px] shrink-0 flex-col gap-4 overflow-y-auto border-l bg-sidebar/60 px-5 py-5 xl:flex">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Smartphone className="size-4 text-muted-foreground" />
          Ledger
        </div>
        <ActivityBanner />
        <LedgerMirror employee={employee} deviceLabel={deviceLabel} rehearsal={rehearsal} />
      </aside>

      <Button
        className="fixed right-5 bottom-5 z-40 rounded-full shadow-lg xl:hidden"
        onClick={() => setDialogOpen(true)}
      >
        <Smartphone />
        Ledger
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ledger</DialogTitle>
            <DialogDescription>{deviceLabel}</DialogDescription>
          </DialogHeader>
          <ActivityBanner />
          {dialogOpen && <LedgerMirror employee={employee} deviceLabel={deviceLabel} rehearsal={rehearsal} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
