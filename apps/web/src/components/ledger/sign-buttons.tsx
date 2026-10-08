"use client";

import { Loader2, PenLine, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/errors";
import { useLedgerActivity } from "./ledger-activity";

/** Approval outcome of a device review: the owner may also refuse on the Ledger itself. */
type Outcome = "approved" | "rejected_on_device";

/** Decision shown as a stamp on the card before the list refreshes and the request moves to the history. */
type Decision = "approved" | "rejected";

/** Long enough for the stamp to land and be read, short enough not to feel like lag. */
const STAMP_VISIBLE_MS = 1100;

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Dashed seal that lands on a decided request ("SIGNED" / "REJECTED", ASCII like the device). */
function DecisionStamp({ decision }: { decision: Decision }) {
  return (
    <span role="status" className={cn("app-stamp", decision === "approved" ? "text-success" : "text-danger")}>
      {decision === "approved" ? "Signed" : "Rejected"}
      <small>{decision === "approved" ? "Ledger" : "Nothing leaves"}</small>
    </span>
  );
}

/**
 * "Approve on my Ledger" / "Reject" pair. Approval runs the server action that waits for the device; the mirror
 * goes live meanwhile. Refusing in the web UI needs no signature (nothing leaves the enclave).
 */
export function ApproveRejectButtons({
  approveLabel = "Approve on my Ledger",
  reviewLabel,
  approve,
  reject,
  approvedMessage,
}: {
  approveLabel?: string;
  /** Shown next to the mirror while the device waits, e.g. "Share with Alice Martin". */
  reviewLabel: string;
  approve: () => Promise<ActionResult<Outcome>>;
  reject: () => Promise<ActionResult>;
  approvedMessage: string;
}) {
  const router = useRouter();
  const { runOnLedger, activity } = useLedgerActivity();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  /** Lets the stamp land on the card, then refreshes (the request leaves the pending list). */
  const settle = async (outcome: Decision): Promise<void> => {
    setDecision(outcome);
    await wait(STAMP_VISIBLE_MS);
  };

  const onApprove = async (): Promise<void> => {
    setBusy("approve");
    const result = await runOnLedger(reviewLabel, approve, {
      success: (outcome) => (outcome === "approved" ? approvedMessage : "Rejected on Ledger."),
    });
    if (result.ok) await settle(result.data === "approved" ? "approved" : "rejected");
    setBusy(null);
    router.refresh();
  };

  const onReject = async (): Promise<void> => {
    setBusy("reject");
    const result = await reject();
    if (result.ok) {
      toast("Request rejected.");
      await settle("rejected");
    } else toast.error(result.message);
    setBusy(null);
    router.refresh();
  };

  return (
    <div className="relative flex flex-wrap items-center gap-2" data-outcome={decision ?? undefined}>
      {decision !== null && (
        <span className="absolute -top-8 right-0 z-10">
          <DecisionStamp decision={decision} />
        </span>
      )}
      <Button size="lg" onClick={() => void onApprove()} disabled={busy !== null || activity !== null}>
        {busy === "approve" ? <Loader2 className="animate-spin" /> : <PenLine />}
        {busy === "approve" ? "Check your Ledger…" : approveLabel}
      </Button>
      <Button variant="ghost" size="lg" onClick={() => void onReject()} disabled={busy !== null}>
        {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />}
        Reject
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
      {busy ? "Check your Ledger…" : label}
    </Button>
  );
}
