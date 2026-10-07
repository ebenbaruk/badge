"use client";

import { Loader2, PenLine, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/errors";
import { useLedgerActivity } from "./ledger-activity";

/** Approval outcome of a device review: the owner may also refuse on the Ledger itself. */
type Outcome = "approved" | "rejected_on_device";

/**
 * "Approve on my Ledger" / "Refuse" pair. Approval runs the server action that waits for the device; the mirror
 * goes live meanwhile. Refusing in the web UI needs no signature (nothing leaves the enclave).
 */
export function ApproveRejectButtons({
  approveLabel = "Approuver sur mon Ledger",
  reviewLabel,
  approve,
  reject,
  approvedMessage,
}: {
  approveLabel?: string;
  /** Shown next to the mirror while the device waits, e.g. "Partager avec Alice Martin". */
  reviewLabel: string;
  approve: () => Promise<ActionResult<Outcome>>;
  reject: () => Promise<ActionResult>;
  approvedMessage: string;
}) {
  const router = useRouter();
  const { runOnLedger, activity } = useLedgerActivity();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const onApprove = async (): Promise<void> => {
    setBusy("approve");
    await runOnLedger(reviewLabel, approve, {
      success: (outcome) => (outcome === "approved" ? approvedMessage : "Refusé sur le Ledger."),
    });
    setBusy(null);
    router.refresh();
  };

  const onReject = async (): Promise<void> => {
    setBusy("reject");
    const result = await reject();
    if (result.ok) toast("Demande refusée.");
    else toast.error(result.message);
    setBusy(null);
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => void onApprove()} disabled={busy !== null || activity !== null}>
        {busy === "approve" ? <Loader2 className="animate-spin" /> : <PenLine />}
        {busy === "approve" ? "Vérifiez sur votre Ledger…" : approveLabel}
      </Button>
      <Button variant="ghost" onClick={() => void onReject()} disabled={busy !== null}>
        {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />}
        Refuser
      </Button>
    </div>
  );
}

/** Single action signed on the device (enroll, delegate, create agreement, revoke, join desk). */
export function LedgerActionButton<T>({
  label,
  reviewLabel,
  action,
  successMessage,
  variant = "default",
  size = "default",
  icon,
}: {
  label: string;
  reviewLabel: string;
  action: () => Promise<ActionResult<T>>;
  successMessage: string;
  variant?: "default" | "outline" | "destructive" | "secondary";
  size?: "default" | "sm";
  icon?: React.ReactNode;
}) {
  const router = useRouter();
  const { runOnLedger, activity } = useLedgerActivity();
  const [busy, setBusy] = useState(false);
  const onClick = async (): Promise<void> => {
    setBusy(true);
    await runOnLedger(reviewLabel, action, { success: () => successMessage });
    setBusy(false);
    router.refresh();
  };
  return (
    <Button variant={variant} size={size} onClick={() => void onClick()} disabled={busy || activity !== null}>
      {busy ? <Loader2 className="animate-spin" /> : (icon ?? <PenLine />)}
      {busy ? "Vérifiez sur votre Ledger…" : label}
    </Button>
  );
}
