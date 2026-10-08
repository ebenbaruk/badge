"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "@/components/motion/use-in-view";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * Example `ContextShare` as Bob's Ledger Flex shows it: the labels are the real ASCII labels of the
 * EIP-712 display descriptor (`@badge/consent`), the values are an illustrative brief request.
 */
const CONTEXT_SHARE_INTENT = "Partager un extrait";
const CONTEXT_SHARE_PAGES: readonly (readonly (readonly [label: string, value: string])[])[] = [
  [
    ["Partager avec", "Alice Martin (Ventes)"],
    ["Extrait", "Notes RDV Orion"],
  ],
  [
    ["Longueur (car.)", "412"],
    ["Tache", "Brief RDV Orion"],
  ],
  [
    ["Expire le", "2026-10-16 18:00 UTC"],
    ["Empreinte", "0x3a9f...c21e"],
  ],
  [["Enclave", "0x9f2b...77d4"]],
];

/** Duration the real Flex asks the owner to keep pressing "Hold to sign". */
const HOLD_TO_SIGN_MS = 3000;
const PAGE_MS = 1700;
const INCOMING_MS = 1600;
const IDLE_MS = 1400;
const SIGNED_MS = 2800;

export type FlexPhase = "idle" | "incoming" | "review" | "signed";

type Screen =
  | { kind: "idle" }
  | { kind: "incoming" }
  | { kind: "page"; index: number }
  | { kind: "hold" }
  | { kind: "signed" };

interface Frame {
  screen: Screen;
  ms: number;
}

const REVIEW_FRAMES: Frame[] = [
  ...CONTEXT_SHARE_PAGES.map((_, index): Frame => ({ screen: { kind: "page", index }, ms: PAGE_MS })),
  { screen: { kind: "hold" }, ms: HOLD_TO_SIGN_MS + 500 },
];

/** Screens played for a phase; `autoplay` chains the whole review in a loop. */
function framesFor(phase: FlexPhase | "autoplay"): Frame[] {
  switch (phase) {
    case "idle":
      return [{ screen: { kind: "idle" }, ms: IDLE_MS }];
    case "incoming":
      return [{ screen: { kind: "incoming" }, ms: INCOMING_MS }];
    case "review":
      return REVIEW_FRAMES;
    case "signed":
      return [{ screen: { kind: "signed" }, ms: SIGNED_MS }];
    case "autoplay":
      return [
        { screen: { kind: "idle" }, ms: IDLE_MS },
        { screen: { kind: "incoming" }, ms: INCOMING_MS },
        ...REVIEW_FRAMES,
        { screen: { kind: "signed" }, ms: SIGNED_MS },
      ];
  }
}

/** Number of screens of a review, for the "2 / 6" page counter (intro + fields + hold). */
const REVIEW_PAGE_COUNT = CONTEXT_SHARE_PAGES.length + 2;

export interface LedgerFlexProps {
  /** Screen to show; omit to loop through the whole consent on its own while in view. */
  phase?: FlexPhase;
  className?: string;
}

/**
 * A Ledger Flex drawn in CSS that plays Badge's real clear-signing screens for a `ContextShare`:
 * review, each field, "Hold to sign" (3 s, like the device) and the signed stamp. It only animates
 * while visible; with reduced motion it shows one still, readable field page.
 */
export function LedgerFlex({ phase, className }: LedgerFlexProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, rootMargin: "0px" });
  const reducedMotion = useReducedMotion();
  const frames = useMemo(() => framesFor(phase ?? "autoplay"), [phase]);
  const [step, setStep] = useState({ phase, index: 0 });
  // A new phase restarts its sequence (state derived during render, no effect round-trip).
  const index = step.phase === phase ? step.index : 0;
  if (step.phase !== phase) setStep({ phase, index: 0 });

  const animate = inView && !reducedMotion && frames.length > 1;
  useEffect(() => {
    if (!animate) return;
    const timer = window.setTimeout(
      () => setStep({ phase, index: (index + 1) % frames.length }),
      frames[index]?.ms ?? PAGE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [animate, frames, index, phase]);

  const still: Screen =
    phase === undefined || phase === "review"
      ? { kind: "page", index: 0 }
      : (frames[0]?.screen ?? { kind: "idle" });
  const screen = reducedMotion ? still : (frames[index]?.screen ?? still);

  return (
    <div ref={ref} className={cn("lp-flex-stage", className)}>
      <div className="lp-flex" data-animate={inView ? "" : undefined}>
        <span aria-hidden="true" className="lp-flex-button" />
        <div className="lp-flex-screen" role="img" aria-label={describe(screen)}>
          <ScreenContent key={screenKey(screen)} screen={screen} />
        </div>
      </div>
    </div>
  );
}

function screenKey(screen: Screen): string {
  return screen.kind === "page" ? `page-${screen.index}` : screen.kind;
}

/** What a screen reader hears instead of the drawn screen. */
function describe(screen: Screen): string {
  switch (screen.kind) {
    case "idle":
      return "Écran du Ledger de Bob : en attente";
    case "incoming":
      return `Écran du Ledger : revoir le message « ${CONTEXT_SHARE_INTENT} »`;
    case "page":
      return `Écran du Ledger : ${(CONTEXT_SHARE_PAGES[screen.index] ?? []).map(([l, v]) => `${l} ${v}`).join(", ")}`;
    case "hold":
      return "Écran du Ledger : maintenir pour signer";
    case "signed":
      return "Écran du Ledger : message signé";
  }
}

function ScreenContent({ screen }: { screen: Screen }) {
  switch (screen.kind) {
    case "idle":
      return (
        <div className="lp-flex-page items-center justify-center text-center">
          <ShieldGlyph />
          <p className="lp-flex-title mt-[6cqw]">Badge</p>
          <p className="lp-flex-label mt-[1.5cqw]">Acme · Bob Durand</p>
          <p className="lp-flex-foot justify-center">Pret</p>
        </div>
      );
    case "incoming":
      return (
        <div className="lp-flex-page items-center justify-center text-center">
          <DocumentGlyph />
          <p className="lp-flex-title mt-[6cqw]">Review message</p>
          <p className="lp-flex-value mt-[2cqw] font-normal">{CONTEXT_SHARE_INTENT}</p>
          <p className="lp-flex-foot justify-center">
            <span className="lp-flex-blink">Tap to continue</span>
          </p>
        </div>
      );
    case "page":
      return (
        <div className="lp-flex-page">
          <dl className="grid gap-[5cqw]">
            {(CONTEXT_SHARE_PAGES[screen.index] ?? []).map(([label, value]) => (
              <div key={label}>
                <dt className="lp-flex-label">{label}</dt>
                <dd className="lp-flex-value mt-[1.5cqw]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="lp-flex-foot justify-between">
            <span>Reject</span>
            <span>
              {screen.index + 2} / {REVIEW_PAGE_COUNT} ›
            </span>
          </p>
        </div>
      );
    case "hold":
      return (
        <div className="lp-flex-page items-center text-center">
          <p className="lp-flex-title mt-[8cqw]">Sign message?</p>
          <p className="lp-flex-label mt-[2cqw]">{CONTEXT_SHARE_INTENT}</p>
          <div className="lp-flex-hold">
            <svg viewBox="0 0 40 40" aria-hidden="true" className="size-[13cqw]">
              <circle cx="20" cy="20" r="17" className="lp-flex-ring-track" />
              <circle cx="20" cy="20" r="17" className="lp-flex-ring" pathLength={100} />
              <path d="M14 20.5 18 24.5 26.5 15.5" className="lp-flex-ring-check" pathLength={100} />
            </svg>
            <span>Hold to sign</span>
          </div>
        </div>
      );
    case "signed":
      return (
        <div className="lp-flex-page items-center justify-center text-center">
          <span aria-hidden="true" className="lp-flex-stamp">
            <b>SIGNE</b>
            <small>EIP-712</small>
          </span>
          <p className="lp-flex-title mt-[8cqw]">Message signed</p>
          <p className="lp-flex-label mt-[2cqw]">Envoye a l&apos;enclave</p>
        </div>
      );
  }
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="size-[16cqw]">
      <path
        d="M16 4 26 7.8v7.6c0 6.2-4.2 10.7-10 12.2-5.8-1.5-10-6-10-12.2V7.8L16 4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="16" cy="14" r="2.6" fill="currentColor" />
      <rect x="15" y="15" width="2" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}

function DocumentGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="size-[16cqw]">
      <path d="M9 4h10l6 6v18H9z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M19 4v6h6M13 16h8M13 20h8M13 24h5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
