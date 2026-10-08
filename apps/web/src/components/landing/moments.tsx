import type { ReactNode } from "react";
import { NudgeArrow } from "@/components/motion/rolling-text";
import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { type LandingImageSlot, PlaceholderImage } from "./placeholder-image";
import { DEMO_ROUTE, SECTION_X, TextLink } from "./primitives";
import { ScrollScene } from "./scroll-scene";

interface Moment {
  id: string;
  /** Glass pill at the top of the card. */
  tag: string;
  title: string;
  body: string;
  /** Label of the pill that follows the mouse inside the card. */
  cursor: string;
  watermark: string;
  /** Card colour classes (fixed pastel, identical in both themes). */
  tone: string;
  art: { slot: LandingImageSlot; alt: string } | "zk";
  /** Optional machine stamp that lands on the card when it scrolls in. */
  stamp?: string;
}

const MOMENTS: readonly Moment[] = [
  {
    id: "ecran",
    tag: "Clear signing",
    title: "Un écran que l'agent ne peut pas falsifier.",
    body: "Ce que Bob lit est calculé par son Ledger à partir du message signé. Ni l'agent, ni le navigateur, ni le serveur ne contrôlent cet écran.",
    cursor: "Signer",
    watermark: "Ledger",
    tone: "bg-fog text-fog-ink",
    art: {
      slot: "act-ledger",
      alt: "Un appareil de signature à écran e-ink, posé en biais, anneau bleu de signature.",
    },
  },
  {
    id: "refus",
    tag: "Agent piégé",
    title: "Agent piégé ? Refusé.",
    body: "Une injection de prompt réclame tout le contexte de Bob. Les règles de l'enclave lèvent l'alerte, Bob refuse sur son Ledger : rien ne sort, et la conformité le voit.",
    cursor: "Bloquer",
    watermark: "Refus",
    tone: "bg-periwinkle text-periwinkle-ink",
    art: {
      slot: "act-refusal",
      alt: "Des barres de données dont la plus haute, rouge, est arrêtée par un bouclier de verre.",
    },
    stamp: "Refuse · aspiration massive",
  },
  {
    id: "permanent",
    tag: "Accords permanents",
    title: "Signé une fois. Tracé à chaque usage.",
    body: "« Mon équipe Ventes peut utiliser mes notes clients pour des briefs, pendant 30 jours. » Moins de validations, aucune perte de trace : chaque usage entre au journal chaîné.",
    cursor: "Déléguer",
    watermark: "Accord",
    tone: "bg-lavender text-lavender-ink",
    art: { slot: "act-memory", alt: "Des anneaux de mémoire empilés, reliés par un point lumineux." },
  },
  {
    id: "revocation",
    tag: "Révocation",
    title: "Un geste, et tout s'arrête.",
    body: "Une révocation signée coupe un accord, ou tout ce qui est partagé avec un collègue. L'enclave refuse chaque usage suivant, et l'écrit au journal.",
    cursor: "Révoquer",
    watermark: "Stop",
    tone: "bg-peach text-peach-ink",
    art: { slot: "act-attest", alt: "Un cube de verre scellé entouré d'anneaux d'orbite." },
  },
  {
    id: "desks",
    tag: "Desks anonymes · ZK",
    title: "Partager entre desks, sans dire qui.",
    body: "Une preuve Semaphore montre qu'un membre du desk a accepté, sans révéler lequel. Seule la conformité peut lever l'anonymat, sur son propre Ledger, et cela laisse une trace.",
    cursor: "Prouver",
    watermark: "ZK",
    tone: "bg-night-2 text-[#c4cee2]",
    art: "zk",
  },
];

/** The five moments of the demo, as tall pastel cards that shrink and drift as they scroll by. */
export function Moments() {
  return (
    <section id="moments" aria-labelledby="moments-title" className={`${SECTION_X} pb-[100px] md:pb-[140px]`}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <RevealText
          as="h2"
          id="moments-title"
          className="max-w-[14em] text-heading-lg"
          text="Cinq moments où la confiance se joue."
        />
        <TextLink href={DEMO_ROUTE}>Les vivre dans la démo</TextLink>
      </div>
      <ol className="mt-12 grid gap-6 md:mt-16">
        {MOMENTS.map((moment, index) => (
          <li key={moment.id}>
            <MomentCard moment={moment} index={index} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function MomentCard({ moment, index }: { moment: Moment; index: number }) {
  return (
    <ScrollScene
      as="article"
      pointer
      aria-labelledby={`moment-${moment.id}`}
      className={`lp-moment relative isolate flex h-[min(650px,90svh)] flex-col overflow-hidden rounded-xl p-5 md:h-[min(880px,95svh)] md:p-7 ${moment.tone}`}
    >
      <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-meta">
        <span className="mono-label">
          {String(index + 1).padStart(2, "0")} / {String(MOMENTS.length).padStart(2, "0")}
        </span>
        <span className="lp-glass-tag rounded-pill border border-[#fff5] bg-[#ffffff65] px-[11px] py-[6px] text-[10px] md:px-[18px] md:py-[9px] md:text-[13px]">
          {moment.tag}
        </span>
        <span className="justify-self-end">{index === 4 ? "Mode desks" : "Démo"}</span>
      </div>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 -translate-y-1/2 text-center text-[140px] leading-none font-semibold tracking-[-0.08em] opacity-[0.055] select-none md:text-[clamp(120px,21vw,330px)]"
      >
        {moment.watermark}
      </span>

      <div className="lp-moment-art relative flex flex-1 items-center justify-center py-4">
        <div className="lp-moment-sculpture w-[min(440px,70%)] md:w-[min(520px,46%)]">
          {moment.art === "zk" ? (
            <ZkSculpture />
          ) : (
            <PlaceholderImage
              slot={moment.art.slot}
              alt={moment.art.alt}
              className="rounded-3xl shadow-[25px_35px_40px_#262d3d2a]"
            />
          )}
        </div>
        {moment.stamp && (
          <Reveal className="lp-stamp-host absolute right-[6%] bottom-[8%] md:right-[12%]" y={0}>
            <span className="lp-card-stamp mono-chip">{moment.stamp}</span>
          </Reveal>
        )}
      </div>

      <div className="relative z-10 grid gap-4 md:grid-cols-[1.4fr_1fr] md:items-end md:gap-10">
        <h3
          id={`moment-${moment.id}`}
          className="text-[36px] leading-[1.03] tracking-[-0.06em] lg:text-[clamp(35px,4.6vw,68px)]"
        >
          {moment.title}
        </h3>
        <p className="max-w-[30em] text-[14px] leading-relaxed opacity-80 md:text-[15px]">{moment.body}</p>
      </div>

      <CaseCursor>{moment.cursor}</CaseCursor>
    </ScrollScene>
  );
}

/** Pill that follows the mouse inside a card (fine pointers only, hidden from assistive tech). */
function CaseCursor({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="lp-case-cursor">
      <span className="pulse-dot" data-tone="on" />
      {children} <NudgeArrow />
    </span>
  );
}

/** Desk members as dots orbiting a proof: one of them signed, nobody can tell which. */
function ZkSculpture() {
  const members = Array.from({ length: 7 }, (_, i) => i);
  return (
    <div
      role="img"
      aria-label="Sept membres d'un desk en orbite autour d'une preuve à divulgation nulle."
      className="lp-zk"
    >
      <div className="lp-zk-orbit">
        {members.map((i) => (
          <span key={i} className="lp-zk-member" style={{ "--k": i } as React.CSSProperties} />
        ))}
      </div>
      <div className="lp-zk-core">
        <span className="mono-chip text-signal">Preuve ZK</span>
        <span className="mt-2 font-mono text-[11px] opacity-70">1 sur 7 · anonyme</span>
      </div>
    </div>
  );
}
