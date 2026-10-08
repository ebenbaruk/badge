import { cn } from "@/lib/utils";

export interface PulseDotProps {
  /** `live` pulses violet, `on` pulses in the primary colour, `off` is a still grey dot. */
  tone?: "live" | "on" | "off";
  /** Accessible status text; omit when a visible label sits next to the dot. */
  label?: string;
  className?: string;
}

/** Small status dot with a breathing halo ("Enclave online", "Simulated"...). */
export function PulseDot({ tone = "live", label, className }: PulseDotProps) {
  return (
    <span
      className={cn("pulse-dot", className)}
      data-tone={tone}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
