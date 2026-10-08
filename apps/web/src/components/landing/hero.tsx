"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { NudgeArrow, RollingText } from "@/components/motion/rolling-text";
import { PlaceholderImage } from "./placeholder-image";
import { heroGate } from "./scroll-math";
import { useScrollVars } from "./use-scroll-vars";
import { WarpCanvas } from "./warp-canvas";

/**
 * Warp hero: a tall section with a sticky night panel. Scrolling shrinks the panel, rushes into the
 * warp, pulls the two halves of the title apart and turns the central "+" into a "✓" — the moment
 * personal context is allowed to flow.
 */
export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const gateRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion();

  useScrollVars(sectionRef, ({ progress }, element) => {
    gateRef.current = heroGate(progress);
    element.style.setProperty("--gate", gateRef.current.toFixed(4));
  });

  return (
    <section ref={sectionRef} id="top" aria-labelledby="hero-title" className="lp-hero relative">
      <div className="sticky top-0 h-svh p-2 md:p-3">
        <div className="lp-hero-panel relative isolate flex h-full flex-col overflow-hidden rounded-xl bg-night text-paper">
          <div aria-hidden="true" className="lp-hero-art absolute inset-0 -z-10">
            <PlaceholderImage slot="hero-warp-poster" hideWatermark className="absolute inset-0 size-full" />
            <WarpCanvas gateRef={gateRef} paused={paused} still={reducedMotion} />
          </div>

          <div className="flex items-start justify-between gap-4 px-4 pt-[88px] text-meta text-[#b6bac5] md:px-7 md:pt-7">
            <span>Badge — Ledger N3XT</span>
            <span className="flex items-center gap-3">
              <span className="hidden sm:inline">Enclave · Intel TDX sur Phala</span>
              {!reducedMotion && (
                <button
                  type="button"
                  onClick={() => setPaused((value) => !value)}
                  aria-pressed={paused}
                  aria-label={paused ? "Relancer l'animation" : "Mettre l'animation en pause"}
                  className="inline-flex size-[30px] items-center justify-center rounded-full border border-[#686c74] bg-[#171b2580] text-paper transition-colors hover:bg-[#ffffff1a]"
                >
                  {paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
                </button>
              )}
            </span>
          </div>

          <div className="flex flex-1 flex-col justify-center px-4 md:px-7">
            <h1 id="hero-title" className="lp-hero-title animate-hero-type text-display-hero">
              <span className="lp-half lp-half-a">Votre contexte.</span>
              <span aria-hidden="true" className="lp-gate">
                <span className="lp-gate-plus">+</span>
                <span className="lp-gate-check">✓</span>
              </span>
              <span className="lp-half lp-half-b">Votre accord.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[34em] text-center text-lede text-[#c9cfdc] md:mt-8">
              Le Ledger devient le badge d&apos;entreprise de l&apos;ère des agents : vos agents puisent dans
              la mémoire de l&apos;entreprise, et le contexte personnel de chacun ne sort qu&apos;avec sa
              signature.
            </p>
          </div>

          <div className="grid items-end gap-5 px-4 pb-5 md:grid-cols-[1fr_auto_1fr] md:px-7 md:pb-7">
            <div>
              <p className="text-[18px] leading-tight tracking-[-0.03em] md:text-[22px]">
                Mémoire d&apos;entreprise, consentie
              </p>
              <p className="mt-1 text-meta text-[#b6bac5]">Signé sur Ledger · Exécuté en enclave</p>
            </div>
            <a
              href="#fonctionnement"
              className="inline-flex min-h-12 items-center justify-between gap-6 rounded-pill bg-signal px-[22px] py-[15px] text-[13px] font-semibold text-on-signal transition-colors duration-300 hover:bg-signal-hover md:min-h-[52px] md:px-6 md:text-[15px]"
            >
              <RollingText>Voir comment ça marche</RollingText>
              <NudgeArrow className="text-[22px] leading-none" />
            </a>
            <p className="text-micro text-[#b6bac5] md:text-right">
              Aucun contexte d&apos;un collègue ne quitte l&apos;enclave sans sa signature.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
