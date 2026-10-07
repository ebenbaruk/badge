import { PlugZap } from "lucide-react";
import type { ActionResult } from "@/server/errors";

/** Rendered instead of a page when the enclave call failed (e.g. live mode not wired yet). */
export function EnclaveUnavailable({ failure }: { failure: Extract<ActionResult, { ok: false }> }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-dashed p-8 text-center">
      <PlugZap className="mx-auto size-6 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-medium">{failure.message}</h2>
      {failure.detail !== undefined && (
        <p className="mt-2 font-mono text-[11px] break-words text-muted-foreground">{failure.detail}</p>
      )}
      {failure.code === "NOT_WIRED" && (
        <p className="mt-3 text-xs text-muted-foreground">
          Démarrez avec <code className="font-mono">BADGE_ENCLAVE_MODE=mock</code> pour la démo scriptée.
        </p>
      )}
    </div>
  );
}
