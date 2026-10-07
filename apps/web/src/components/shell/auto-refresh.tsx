"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLedgerActivity } from "@/components/ledger/ledger-activity";

/** Other employees act in parallel (approve on their Ledger, send requests): re-read server data regularly. */
const REFRESH_INTERVAL_MS = 2500;

/**
 * Refreshes the server components of the current page. Client state (forms, toggles) is preserved by
 * `router.refresh()`. Paused while the tab is hidden and while a device review runs (the action revalidates).
 */
export function AutoRefresh() {
  const router = useRouter();
  const { activity } = useLedgerActivity();
  useEffect(() => {
    if (activity !== null) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [router, activity]);
  return null;
}
