"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLedgerActivity } from "@/components/ledger/ledger-activity";

/** Other employees act in parallel (approve on their Ledger, send requests): re-read server data regularly. */
const REFRESH_INTERVAL_MS = 2500;
/**
 * Slower cadence while the tab is hidden. A window merely covered by another one is reported hidden on macOS: the
 * page must still follow the other employees (a presenter switching windows), just with less load on the enclave.
 */
const HIDDEN_REFRESH_INTERVAL_MS = 10_000;

/**
 * Refreshes the server components of the current page. Client state (forms, toggles) is preserved by
 * `router.refresh()`. Slower while the tab is hidden, paused while a device review runs (the action revalidates).
 */
export function AutoRefresh() {
  const router = useRouter();
  const { activity } = useLedgerActivity();
  useEffect(() => {
    if (activity !== null) return;
    let lastRefresh = Date.now();
    const refresh = (): void => {
      lastRefresh = Date.now();
      router.refresh();
    };
    const timer = window.setInterval(() => {
      const interval = document.hidden ? HIDDEN_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS;
      if (Date.now() - lastRefresh >= interval) refresh();
    }, REFRESH_INTERVAL_MS);
    // Back on the tab: show the current state at once rather than at the next tick.
    const onVisibilityChange = (): void => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, activity]);
  return null;
}
