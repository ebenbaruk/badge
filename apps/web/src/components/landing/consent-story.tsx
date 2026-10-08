"use client";

import { useRef, useState } from "react";
import { RevealText } from "@/components/motion/reveal-text";
import { type FlexPhase, LedgerFlex } from "./ledger-flex";
import { Aside, SECTION_X } from "./primitives";
import { activeStepIndex } from "./scroll-math";
import { useScrollVars } from "./use-scroll-vars";

/** Steps are read when their centre crosses this share of the viewport height. */
const READING_LINE = 0.55;

const STEPS: readonly { title: string; body: string; chip: string; phase: FlexPhase }[] = [
  {
    title: "L'agent demande",
    body: "Alice demande à son agent le brief du rendez-vous Orion. L'agent interroge Badge avec une clé de session déléguée par son Ledger : elle donne le droit de demander, jamais celui de décider.",
    chip: "Agent · cle de session",
    phase: "idle",
  },
  {
    title: "L'enclave sélectionne",
    body: "Dans l'enclave, Badge prend le contexte global et les notes d'Alice, puis repère trois extraits utiles dans les notes de Bob. Des règles déterministes écartent les données personnelles et toute aspiration massive.",
    chip: "Enclave · regles",
    phase: "incoming",
  },
  {
    title: "Bob signe sur son Ledger",
    body: "Son appareil affiche exactement ce qu'il accorde : à qui, quel extrait, sa longueur, pour quelle tâche, jusqu'à quand, l'empreinte du texte et la mesure de l'enclave. Appui long : signé.",
    chip: "Ledger · clear signing",
    phase: "review",
  },
  {
    title: "Seul cet extrait sort",
    body: "L'enclave vérifie la signature, l'expiration, le nonce et l'empreinte, puis rédige le brief avec ce seul extrait, provenance à l'appui. Le reste du contexte de Bob ne quitte pas l'enclave.",
    chip: "Brief · provenance",
    phase: "signed",
  },
];

type StepState = "locked" | "now" | "done";

/**
 * Scroll-driven storyboard of one consent: a sticky Ledger Flex on one side, the four steps on the
 * other. The step being read lights up and the device plays the matching screen.
 */
export function ConsentStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useScrollVars(sectionRef, ({ viewport }) => {
    const rects = stepRefs.current.map((step) => step?.getBoundingClientRect() ?? { top: 0, height: 0 });
    const next = activeStepIndex(rects, viewport * READING_LINE);
    // Bail out of React when nothing changed: this runs on every scroll frame.
    setActive((current) => (current === next ? current : next));
  });

  const stateOf = (index: number): StepState =>
    index < active ? "done" : index === active ? "now" : "locked";
  const phase = STEPS[active]?.phase ?? "idle";

  return (
    <section
      ref={sectionRef}
      id="fonctionnement"
      aria-labelledby="story-title"
      className={`${SECTION_X} py-[100px] md:py-[140px]`}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_2.4fr] md:gap-[60px]">
        <Aside>Comment ça marche</Aside>
        <div>
          <RevealText
            as="h2"
            id="story-title"
            className="text-heading-lg"
            text="Quatre temps. Une seule signature."
          />
          <p className="mt-6 max-w-[36em] text-lede text-ink-muted-2">
            Le parcours réel de la démo : Alice prépare un rendez-vous client, son agent a besoin des notes de
            Bob.
          </p>
        </div>
      </div>

      <div className="mt-12 grid gap-8 lg:mt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <div className="sticky top-[96px] z-10 -mx-4 bg-paper/90 px-4 pb-4 backdrop-blur-md lg:top-0 lg:mx-0 lg:flex lg:h-svh lg:items-center lg:justify-center lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <div className="flex items-center justify-center gap-5 lg:block">
            <LedgerFlex phase={phase} className="w-[min(150px,38vw)] lg:w-[min(340px,80%)]" />
            <p aria-live="polite" className="mono-label text-ink-muted lg:mt-8 lg:text-center">
              {active + 1} / {STEPS.length} · {STEPS[active]?.title}
            </p>
          </div>
        </div>

        <ol className="grid gap-6 lg:gap-0">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              ref={(element) => {
                stepRefs.current[index] = element;
              }}
              className="lg:flex lg:min-h-[78svh] lg:items-center"
            >
              <article data-state={stateOf(index)} className="lp-flow-step w-full">
                <div className="flex items-center gap-3">
                  <span className="lp-flow-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="mono-chip lp-flow-chip">{step.chip}</span>
                </div>
                <h3 className="mt-5 text-[clamp(24px,2.4vw,34px)] leading-[1.1] tracking-[-0.05em]">
                  <span className="sr-only">Étape {index + 1} : </span>
                  {step.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-muted-2">{step.body}</p>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
