import Image from "next/image";
import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { CountUp } from "./count-up";
import { Aside, SECTION_X } from "./primitives";

const FACTS = [
  { value: 1, label: "Ledger signature per excerpt of a colleague's context" },
  { value: 0, label: "personal text sent without its owner's consent" },
  { value: 3, label: "members minimum to share anonymously as a desk" },
] as const;

const CONTEXT_ALT =
  "Badge's memory at the centre. Company sources, a globe, documents, a chart and mail, flow into it on solid lines; personal sources, notes, a calendar, a conversation and a person, reach it on dashed lines held by a lock.";

/** The problem: context is king, it is global and personal, and today one server sees all of it. */
export function Intro() {
  return (
    <section aria-labelledby="intro-title" className={`${SECTION_X} py-[100px] md:py-[140px]`}>
      <div className="grid gap-4 md:grid-cols-[1fr_2.4fr] md:gap-[60px]">
        <div>
          <Aside>For AI-native companies</Aside>
          <Reveal
            as="figure"
            delay={80}
            className="mx-auto mt-10 hidden w-full max-w-[300px] md:block xl:max-w-[360px] 2xl:max-w-[440px]"
          >
            <Image
              src="/landing/context-memory-light.png"
              alt={CONTEXT_ALT}
              width={1000}
              height={1000}
              sizes="(max-width: 1280px) 300px, 440px"
              className="h-auto w-full dark:hidden"
            />
            <Image
              src="/landing/context-memory-dark.png"
              alt={CONTEXT_ALT}
              width={1000}
              height={1000}
              sizes="(max-width: 1280px) 300px, 440px"
              className="hidden h-auto w-full dark:block"
            />
            <figcaption className="mt-1 grid gap-1.5 text-[13px] leading-snug text-ink-muted-2">
              <span className="flex items-center gap-2.5">
                <span aria-hidden="true" className="h-0 w-6 border-t-2 border-cobalt" />
                Company context, open to everyone
              </span>
              <span className="flex items-center gap-2.5">
                <span aria-hidden="true" className="h-0 w-6 border-t-2 border-dashed border-violet" />
                Personal context, released on its owner&apos;s signature
              </span>
            </figcaption>
          </Reveal>
        </div>
        <div className="min-w-0">
          <RevealText
            as="h2"
            id="intro-title"
            className="text-heading-xl"
            text="Agents run on context. Personal context runs on consent."
          />
          <Reveal as="p" delay={120} className="mt-8 max-w-[38em] text-lede-lg text-ink-muted-2">
            Context is the most valuable asset of the AI era: the right context for the right task saves
            tokens and gets the job done. There is the{" "}
            <strong className="font-semibold text-ink">company</strong> context: the business, its clients,
            its news, open to everyone. And each employee&apos;s{" "}
            <strong className="font-semibold text-ink">personal</strong> context: notes, meetings,
            conversations. That is what makes an agent truly useful, and it is exactly what you can&apos;t
            hand to a server that sees everything.
          </Reveal>

          <dl className="mt-12 grid gap-6 sm:grid-cols-3 sm:gap-0">
            {FACTS.map((fact) => (
              <div
                key={fact.label}
                className="sm:border-r sm:border-line sm:px-6 sm:first:pl-0 sm:last:border-r-0"
              >
                <dt className="sr-only">{fact.label}</dt>
                <dd>
                  <CountUp value={fact.value} className="block text-heading-md" />
                  <span className="mt-1 block text-[14px] text-ink-muted-2">{fact.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
