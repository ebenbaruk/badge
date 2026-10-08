import { cn } from "@/lib/utils";

/**
 * Image slots of the landing (see `public/landing/ASSETS.md`). Each slot keeps the background
 * colour of its future image, so the page already reads right before the images exist.
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
  /** Accessible description of the future image; omit for a purely decorative slot. */
  alt?: string;
  className?: string;
  /** Hide the giant watermark word (small tiles). */
  hideWatermark?: boolean;
}

/**
 * Stand-in for a generated image: the slot's solid colour, a faint watermark word and a small
 * mono label `IMG · <slot>`. Never a broken image. Takes the radius of its container.
 */
export function PlaceholderImage({ slot, alt, className, hideWatermark = false }: PlaceholderImageProps) {
  const { background, ink, ratio, watermark } = LANDING_IMAGE_SLOTS[slot];
  return (
    <div
      role={alt ? "img" : undefined}
      aria-label={alt}
      aria-hidden={alt ? undefined : true}
      data-slot-id={slot}
      className={cn(
        "@container relative isolate grid place-items-center overflow-hidden rounded-[inherit]",
        className,
      )}
      style={{ background, color: ink, aspectRatio: ratio }}
    >
      {/* Soft top-left light, like the studio lighting of the future renders. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: "radial-gradient(120% 90% at 20% 10%, #ffffff2e, transparent 60%)" }}
      />
      {!hideWatermark && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-[6%] text-center text-[clamp(48px,14cqw,220px)] leading-none font-semibold tracking-[-0.08em] opacity-[0.055] select-none"
        >
          {watermark}
        </span>
      )}
      <span aria-hidden="true" className="mono-label opacity-70">
        IMG · {slot}
      </span>
    </div>
  );
}
