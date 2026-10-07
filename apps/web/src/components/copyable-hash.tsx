"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { shortHex } from "@/lib/format";
import { cn } from "@/lib/utils";

const COPIED_FEEDBACK_MS = 1200;

/** Monospace hash, shortened unless `full`, copied to the clipboard on click. */
export function CopyableHash({
  value,
  full = false,
  className,
}: {
  value: string;
  full?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };
  return (
    <button
      type="button"
      title={value}
      onClick={() => void copy()}
      className={cn(
        "group inline-flex max-w-full items-start gap-1 text-left font-mono text-[11px] text-foreground/85 hover:text-foreground",
        className,
      )}
    >
      <span className={cn(full ? "break-all" : "truncate")}>{full ? value : shortHex(value)}</span>
      {copied ? (
        <Check className="mt-px size-3 shrink-0 text-success" />
      ) : (
        <Copy className="mt-px size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  );
}
