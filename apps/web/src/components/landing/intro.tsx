import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { Stagger } from "@/components/motion/stagger";
import { CountUp } from "./count-up";
import { EditorialGrid, SECTION_X } from "./primitives";

const FACTS = [
  { value: 1, label: "signature sur le Ledger par extrait d'un collègue" },
  { value: 0, label: "texte personnel envoyé sans accord du propriétaire" },
  { value: 3, label: "membres minimum pour partager sous l'anonymat d'un desk" },
] as const;

const CONTRAST = [
  {
    title: "Aujourd'hui",
    tone: "text-ink-muted-2",
    items: [
      "Un serveur central ingère tout le contexte et le voit en clair.",
      "Un agent piégé peut tout aspirer, personne ne le remarque.",
      "Le consentement est une case cochée une fois, jamais relue.",
    ],
  },
  {
    title: "Avec Badge",
    tone: "text-cobalt",
    items: [
      "La mémoire vit dans une enclave matérielle que chacun vérifie.",
      "Chaque extrait d'un collègue attend sa signature, sur son appareil.",
      "Chaque usage est journalisé, chaque accord révocable d'un geste.",
    ],
  },
] as const;

/** The problem: context is king, it is global and personal, and today one server sees all of it. */
export function Intro() {
  return (
    <section aria-labelledby="intro-title" className={`${SECTION_X} py-[100px] md:py-[140px]`}>
      <EditorialGrid aside="Pour les entreprises AI native">
        <RevealText
          as="h2"
          id="intro-title"
          className="text-heading-xl"
          text="Les agents ont besoin de contexte. Le contexte de chacun a besoin de son accord."
        />
        <Reveal as="p" delay={120} className="mt-8 max-w-[38em] text-lede-lg text-ink-muted-2">
          Il y a le contexte <strong className="font-semibold text-ink">global</strong> : l&apos;entreprise,
          ses clients, ses actualités, ouvert à tous. Et le contexte{" "}
          <strong className="font-semibold text-ink">personnel</strong> de chacun : ses notes, ses
          rendez-vous, ses échanges. C&apos;est lui qui rend un agent vraiment utile, et c&apos;est lui
          qu&apos;on ne peut pas confier à un serveur qui voit tout.
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
