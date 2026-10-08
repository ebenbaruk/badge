import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { Stagger } from "@/components/motion/stagger";
import { CountUp } from "./count-up";
import { EditorialGrid, SECTION_X } from "./primitives";

const FACTS = [
  { value: 1, label: "Ledger signature per excerpt of a colleague's context" },
  { value: 0, label: "personal text sent without its owner's consent" },
  { value: 3, label: "members minimum to share anonymously as a desk" },
] as const;

const CONTRAST = [
  {
    title: "Today",
    tone: "text-ink-muted-2",
    items: [
      "Either a central server ingests everyone's context and sees it in the clear...",
      "...or rigid guardrails keep agents in the dark, and they burn tokens guessing.",
      "Consent is a box ticked once and never revisited.",
    ],
  },
  {
    title: "With Badge",
    tone: "text-cobalt",
    items: [
      "One memory knows the company and every employee, sealed in an enclave anyone can verify.",
      "It injects the right context for each task; a colleague's excerpt waits for their signature.",
      "Every use is logged, every consent revocable in one move.",
    ],
  },
] as const;

/** The problem: context is king, it is global and personal, and today one server sees all of it. */
export function Intro() {
  return (
    <section aria-labelledby="intro-title" className={`${SECTION_X} py-[100px] md:py-[140px]`}>
      <EditorialGrid aside="For AI-native companies">
        <RevealText
          as="h2"
          id="intro-title"
          className="text-heading-xl"
          text="Agents run on context. Personal context runs on consent."
        />
        <Reveal as="p" delay={120} className="mt-8 max-w-[38em] text-lede-lg text-ink-muted-2">
          Context is the most valuable asset of the AI era: the right context for the right task saves tokens
          and gets the job done. There is the <strong className="font-semibold text-ink">company</strong>{" "}
          context: the business, its clients, its news, open to everyone. And each employee&apos;s{" "}
          <strong className="font-semibold text-ink">personal</strong> context: notes, meetings,
          conversations. That is what makes an agent truly useful, and it is exactly what you can&apos;t hand
          to a server that sees everything.
        </Reveal>

        <Stagger as="ul" className="mt-12 grid gap-6 md:grid-cols-2 md:gap-10" itemClassName="list-none">
          {CONTRAST.map((column) => (
            <div key={column.title}>
              <p className={`mono-label ${column.tone}`}>{column.title}</p>
              <ul className="mt-3">
                {column.items.map((item) => (
                  <li key={item} className="border-t border-[#c5c9d2] py-[17px] text-[15px]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Stagger>

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
      </EditorialGrid>
    </section>
  );
}
