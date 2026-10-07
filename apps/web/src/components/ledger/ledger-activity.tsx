"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";

/** A device review in progress, started from the UI (what the mirror shows a banner for). */
export interface LedgerActivity {
  /** What the user is asked to review, e.g. "Approuver le partage avec Alice". */
  label: string;
  startedAt: number;
}

interface LedgerActivityContextValue {
  activity: LedgerActivity | null;
  /**
   * Runs a server action that waits for the employee's Ledger. The mirror switches to live mode for the whole
   * duration; the outcome is reported as a toast (success or the typed failure message).
   */
  runOnLedger: <T>(
    label: string,
    action: () => Promise<ActionResult<T>>,
    messages?: { success?: (data: T) => string | null },
  ) => Promise<ActionResult<T>>;
}

const LedgerActivityContext = createContext<LedgerActivityContextValue | null>(null);

export function LedgerActivityProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<LedgerActivity | null>(null);

  const runOnLedger = useCallback<LedgerActivityContextValue["runOnLedger"]>(
    async (label, action, messages) => {
      setActivity({ label, startedAt: Date.now() });
      try {
        const result = await action();
        if (result.ok) {
          const message = messages?.success?.(result.data);
          if (message !== null && message !== undefined) toast.success(message);
        } else {
          toast.error(result.message, result.detail === undefined ? {} : { description: result.detail });
        }
        return result;
      } finally {
        setActivity(null);
      }
    },
    [],
  );

  const value = useMemo(() => ({ activity, runOnLedger }), [activity, runOnLedger]);
  return <LedgerActivityContext.Provider value={value}>{children}</LedgerActivityContext.Provider>;
}

export function useLedgerActivity(): LedgerActivityContextValue {
  const context = useContext(LedgerActivityContext);
  if (context === null) throw new Error("useLedgerActivity must be used inside LedgerActivityProvider");
  return context;
}
