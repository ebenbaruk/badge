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
    title: "The agent asks",
    body: "Alice asks her agent for the Morpho meeting brief. The agent queries Badge with a session key delegated by her Ledger: it grants the right to ask, never the right to decide.",
    chip: "Agent · session key",
    phase: "idle",
  },
  {
    title: "The enclave selects",
    body: "Inside the enclave, Badge's memory already knows everyone's context. It pulls the company context and Alice's notes, then spots three useful excerpts in Bob's notes. Deterministic rules screen out personal data and any bulk extraction.",
    chip: "Enclave · rules",
    phase: "incoming",
  },
  {
    title: "Bob signs on his Ledger",
    body: "His device shows what he is granting: to whom, the start of the excerpt and its length, for which task, until when, the text's fingerprint and the enclave measurement. Hold to sign: done.",
    chip: "Ledger · clear signing",
    phase: "review",
  },
  {
    title: "Only that excerpt leaves",
    body: "The enclave checks the signature, expiry, nonce and fingerprint, then writes the brief with that single excerpt, provenance attached. The rest of Bob's context never leaves the enclave.",
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
      id="how-it-works"
      aria-labelledby="story-title"
      className={`${SECTION_X} py-[100px] md:py-[140px]`}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_2.4fr] md:gap-[60px]">
        <Aside>How it works</Aside>
        <div>
          <RevealText
            as="h2"
            id="story-title"
            className="text-heading-lg"
            text="Four steps. One signature."
          />
          <p className="mt-6 max-w-[36em] text-lede text-ink-muted-2">
            The real flow of the demo: Alice is preparing a client meeting, and her agent needs Bob&apos;s
            notes.
          </p>
        </div>
      </div>

      <div className="mt-12 grid gap-8 lg:mt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <div className="sticky top-[96px] z-10 -mx-4 bg-paper/90 px-4 pb-4 backdrop-blur-md lg:top-0 lg:mx-0 lg:flex lg:h-svh lg:items-center lg:justify-center lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          <div className="flex items-center justify-center gap-5 lg:block lg:w-full">
            <LedgerFlex phase={phase} className="w-[min(112px,30vw)] lg:mx-auto lg:w-[min(340px,70%)]" />
            <p aria-live="polite" className="mono-label text-ink-muted lg:mt-8 lg:text-center">
              {active + 1} / {STEPS.length} · {STEPS[active]?.title}
            </p>
            <p className="mono-label hidden text-ink-muted-3 lg:mt-2 lg:block lg:text-center">
              Illustrative example
            </p>
          </div>
        </div>

        <ol className="grid gap-6 lg:max-w-[640px] lg:gap-0">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              ref={(element) => {
                stepRefs.current[index] = element;
              }}
              className="lg:flex lg:min-h-[42svh] lg:items-center"
            >
              <article data-state={stateOf(index)} className="lp-flow-step w-full">
                <div className="flex items-center gap-3">
                  <span className="lp-flow-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="mono-chip lp-flow-chip">{step.chip}</span>
                </div>
                <h3 className="mt-5 text-[clamp(24px,2.4vw,34px)] leading-[1.1] tracking-[-0.05em]">
                  <span className="sr-only">Step {index + 1}: </span>
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
