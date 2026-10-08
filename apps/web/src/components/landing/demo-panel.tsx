import type { Route } from "next";
import Link from "next/link";
import { NudgeArrow, RollingText } from "@/components/motion/rolling-text";
import { PulseDot } from "@/components/motion/pulse-dot";
import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { EMPLOYEES } from "@/lib/directory";
import { type LandingImageSlot, PlaceholderImage } from "./placeholder-image";
import { DEMO_ROUTE, SECTION_X } from "./primitives";
import { ScrollScene } from "./scroll-scene";

const PERSONAS: readonly {
  employee: (typeof EMPLOYEES)[keyof typeof EMPLOYEES];
  slot: LandingImageSlot;
  role: string;
  href: Route;
}[] = [
  {
    employee: EMPLOYEES.alice,
    slot: "persona-alice",
    role: "Asks her agent for a brief",
    href: "/alice/agent" as Route,
  },
  {
    employee: EMPLOYEES.bob,
    slot: "persona-bob",
    role: "Approves or rejects on his Ledger",
    href: "/bob/consents" as Route,
  },
  {
    employee: EMPLOYEES.chloe,
    slot: "persona-chloe",
    role: "Reviews the log and alerts",
    href: "/chloe/compliance" as Route,
  },
];

const FLOW = [
  "Pick a task in Alice's agent",
  "Sign on Bob's Ledger (Speculos)",
  "Read the brief and its provenance",
] as const;

/**
 * "Try Badge": the royal-blue panel grows out of a nav-sized pill as it scrolls in (clip-path on
 * `--unfold`), then offers the three personas of the demo.
 */
export function DemoPanel() {
  return (
    <section id="demo" aria-labelledby="demo-title" className={`${SECTION_X} pb-[100px] md:pb-[140px]`}>
      <div className="mx-auto max-w-[760px] text-center">
        <p className="text-meta text-ink-muted-2">The demo</p>
        <RevealText as="h2" id="demo-title" className="mt-4 text-display-xl" text="Try Badge." />
        <Reveal as="p" delay={100} className="mx-auto mt-6 max-w-[34em] text-[17px] text-ink-muted-2">
          Three Acme employees, three Ledger Flex devices (Speculos), one enclave. Pick a role and follow the
          flow end to end.
        </Reveal>
      </div>

      <ScrollScene
        unfold
        className="lp-unfold mx-auto mt-14 max-w-[960px] rounded-4xl bg-brand-deep text-paper"
      >
        <div className="lp-unfold-content p-4 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 px-2 pt-2">
            <h3 className="text-[clamp(29px,3vw,44px)] leading-[1.2] tracking-[-0.055em]">Pick a role</h3>
            <span className="inline-flex items-center gap-2 text-meta text-[#c4cee2]">
              <PulseDot tone="live" />
              Local demo · Speculos Ledger
            </span>
          </div>

          <ul className="mt-6 grid gap-3 md:grid-cols-3">
            {PERSONAS.map(({ employee, slot, role, href }) => (
              <li key={employee.id}>
                <Link
                  href={href}
                  className="group flex h-full items-center gap-4 rounded-lg bg-paper p-3 text-ink transition-transform duration-500 ease-out-soft hover:-translate-y-[5px] md:flex-col md:items-stretch md:p-4"
                >
                  <div className="w-[72px] shrink-0 overflow-hidden rounded-md md:w-full">
                    <PlaceholderImage
                      slot={slot}
                      hideWatermark
                      className="transition-transform duration-[650ms] ease-out-soft group-hover:scale-105"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold tracking-[-0.035em]">
                      <RollingText>{employee.name}</RollingText>
                    </p>
                    <p className="text-[13px] text-ink-muted-3">{employee.team}</p>
                    <p className="mt-2 inline-flex gap-1 text-[12px]">
                      {role} <NudgeArrow />
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <ol className="mt-3 grid gap-3 md:grid-cols-3">
            {FLOW.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-3 rounded-lg border border-[#ffffff26] px-4 py-4 text-[14px]"
              >
                <span className="grid size-[26px] shrink-0 place-items-center rounded-full border-[1.5px] border-[#a7c8ff] font-mono text-[12px] font-semibold text-[#a7c8ff]">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          <Link
            href={DEMO_ROUTE}
            className="mt-3 flex min-h-14 w-full items-center justify-between rounded-pill bg-signal px-6 py-[18px] text-[15px] font-semibold text-on-signal transition-colors duration-300 hover:bg-signal-hover"
          >
            <RollingText>Open the demo</RollingText>
            <NudgeArrow className="text-[22px] leading-none" />
          </Link>
        </div>
      </ScrollScene>
    </section>
  );
}
