"use client";

import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { PulseDot } from "@/components/motion/pulse-dot";
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
        Consent is signed here, on the employee&apos;s Ledger: what the screen shows is exactly what gets
        signed.
      </p>
    );
  }
  // Deep royal blue: the reference's colour for what matters now. Keyed so each new review replays the entry.
  return (
    <div
      key={activity.startedAt}
      className="animate-gallery-in rounded-2xl bg-brand-deep p-4 text-xs text-paper shadow-[0_18px_40px_-20px_var(--color-brand-deep)]"
    >
      <div className="flex items-center gap-2 mono-label text-signal-hover">
        <PulseDot tone="on" />
        Signature requested
      </div>
      <div className="mt-2.5 text-[15px] leading-snug font-semibold tracking-[-0.03em]">Check the Ledger</div>
      <p className="mt-1 text-paper/75">{activity.label}</p>
      <p className="mt-2 border-t border-paper/15 pt-2 text-paper/60">
        Scroll through, then press &quot;Hold to sign&quot;.
      </p>
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
      <aside className="sticky top-0 hidden h-svh w-[340px] shrink-0 flex-col gap-5 overflow-y-auto border-l bg-sidebar px-6 py-6 xl:flex">
        <div className="flex items-center justify-between">
          <div className="font-heading text-xl leading-none font-medium tracking-[-0.05em]">Ledger</div>
          <span className="mono-label text-muted-foreground">Clear signing</span>
        </div>
        <ActivityBanner />
        <LedgerMirror key={employee} employee={employee} deviceLabel={deviceLabel} rehearsal={rehearsal} />
      </aside>

      <Button
        variant="night"
        size="lg"
        className="fixed right-5 bottom-[calc(88px+env(safe-area-inset-bottom))] z-40 md:bottom-5 shadow-nav xl:hidden"
        onClick={() => setDialogOpen(true)}
      >
        {activity === null ? <Smartphone /> : <PulseDot tone="on" />}
        Ledger
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ledger</DialogTitle>
            <DialogDescription>{deviceLabel}</DialogDescription>
          </DialogHeader>
          <ActivityBanner />
          {dialogOpen && (
            <LedgerMirror
              key={employee}
              employee={employee}
              deviceLabel={deviceLabel}
              rehearsal={rehearsal}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
