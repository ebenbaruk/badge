import type { Route } from "next";
import { Bot, PlugZap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { EmployeeId } from "@/lib/directory";
import type { ActionResult } from "@/server/errors";

/**
 * Rendered instead of a page when the enclave call failed (enclave down, attestation refused, no agent session).
 * Without a session the fix is one Ledger signature away: link straight to it.
 */
export function EnclaveUnavailable({
  failure,
  employee,
}: {
  failure: Extract<ActionResult, { ok: false }>;
  employee: EmployeeId;
}) {
  const needsSession = failure.code === "NO_SESSION";
  return (
    <div className="mx-auto mt-16 max-w-md animate-gallery-in rounded-3xl border border-dashed bg-surface/50 p-10 text-center">
      {needsSession ? (
        <Bot className="mx-auto size-7 text-muted-foreground" />
      ) : (
        <PlugZap className="mx-auto size-7 text-muted-foreground" />
      )}
      <h2 className="mt-4 text-lg leading-snug tracking-[-0.04em]">{failure.message}</h2>
      {failure.detail !== undefined && !needsSession && (
        <p className="mt-2 font-mono text-[11px] break-words text-muted-foreground">{failure.detail}</p>
      )}
      {needsSession && (
        <Button asChild variant="night" className="mt-5">
          <Link href={`/${employee}/onboarding` as Route}>Open setup</Link>
        </Button>
      )}
    </div>
  );
}
