import Image from "next/image";
import { Sculpture } from "./sculpture";
import { cn } from "@/lib/utils";

/**
 * Shared artwork slots. Background colours reserve a stable surface while each image loads.
 */
export const LANDING_IMAGE_SLOTS = {
  "hero-warp-poster": { background: "#060010", ink: "#b5d6ff", ratio: "16 / 10", watermark: "Warp" },
  "act-memory": { background: "#c8bef9", ink: "#282044", ratio: "1 / 1", watermark: "Mémoire" },
  "act-ledger": { background: "#e0e2e8", ink: "#282e3c", ratio: "1 / 1", watermark: "Ledger" },
  "act-refusal": { background: "#9bb3eb", ink: "#20283b", ratio: "1 / 1", watermark: "Refus" },
  "act-attest": { background: "#e9ab86", ink: "#422c23", ratio: "1 / 1", watermark: "Preuve" },
  "tile-global": { background: "#c8bef9", ink: "#292442", ratio: "1 / 1", watermark: "Global" },
  "tile-personal": { background: "#1b2231", ink: "#5c99ff", ratio: "1 / 1", watermark: "Perso" },
  "tile-consent": { background: "#e9ab86", ink: "#47281a", ratio: "1 / 1", watermark: "Accord" },
  "tile-enclave": { background: "#dadce2", ink: "#282e3c", ratio: "1 / 1", watermark: "TEE" },
  "consent-receipt": { background: "#143c91", ink: "#f5f7fc", ratio: "1 / 1", watermark: "Reçu" },
  "attestation-report": { background: "#143c91", ink: "#89b9ff", ratio: "1 / 1", watermark: "TDX" },
  "persona-alice": { background: "#c8bef9", ink: "#282044", ratio: "1 / 1", watermark: "Alice" },
  "persona-bob": { background: "#9bb3eb", ink: "#20283b", ratio: "1 / 1", watermark: "Bob" },
  "persona-chloe": { background: "#e9ab86", ink: "#422c23", ratio: "1 / 1", watermark: "Chloé" },
  "og-image": { background: "#060010", ink: "#b5d6ff", ratio: "1200 / 630", watermark: "Badge" },
} as const satisfies Record<string, { background: string; ink: string; ratio: string; watermark: string }>;

export type LandingImageSlot = keyof typeof LANDING_IMAGE_SLOTS;

export interface PlaceholderImageProps {
  slot: LandingImageSlot;
  /** Accessible description of the illustration; omit for a purely decorative slot. */
  alt?: string;
  className?: string;
  /** Legacy prop retained for existing call sites; artwork never displays a watermark. */
  hideWatermark?: boolean;
}

/** Optimized artwork exported from the shared studio illustration collection. */
export function PlaceholderImage({ slot, alt, className }: PlaceholderImageProps) {
  const { background, ratio } = LANDING_IMAGE_SLOTS[slot];
  const sculpture =
    slot === "act-memory"
      ? "memory"
      : slot === "act-ledger"
        ? "signer"
        : slot === "act-refusal"
          ? "shield"
          : slot === "act-attest"
            ? "enclave"
            : null;
  if (sculpture)
    return (
      <div
        role={alt ? "img" : undefined}
        aria-label={alt}
        className={cn("relative grid place-items-center", className)}
        style={{ aspectRatio: ratio }}
      >
        <Sculpture kind={sculpture} />
      </div>
    );
  const file =
    slot === "hero-warp-poster" || slot === "og-image"
      ? "memory-hero"
      : slot === "persona-bob"
        ? "persona-alice"
        : slot;
  return (
    <div
      data-slot-id={slot}
      className={cn("relative isolate overflow-hidden rounded-[inherit]", className)}
      style={{ background, aspectRatio: ratio }}
    >
      <Image
        src={`/landing/${file}.webp`}
        alt={alt ?? ""}
        fill
        sizes={slot.startsWith("tile-") ? "(max-width: 640px) 85vw, 115px" : "(max-width: 768px) 80vw, 520px"}
        className={cn("object-cover", slot === "persona-bob" && "-hue-rotate-30")}
      />
    </div>
  );
}
