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
    id: "refusal",
    tag: "Compromised agent",
    title: "Compromised agent? Denied.",
    body: "A prompt injection demands all of Bob's context. The enclave rules raise the alarm and Bob rejects it on his Ledger: nothing leaves, and compliance sees it.",
    cursor: "Block",
    watermark: "Denied",
    tone: "bg-periwinkle text-periwinkle-ink",
    art: {
      slot: "act-refusal",
      alt: "A shield guarding a row of data bars.",
    },
    stamp: "Rejected · bulk extraction",
  },
  {
    id: "standing",
    tag: "Standing agreements",
    title: "Signed once. Logged every time.",
    body: '"My Sales team can use my client notes for client briefs, for 30 days." Every use lands in the hash-chained log, and one signed revocation stops it all.',
    cursor: "Delegate",
    watermark: "Consent",
    tone: "bg-lavender text-lavender-ink",
    art: { slot: "act-memory", alt: "Three stacked lavender memory rings." },
  },
  {
    id: "desks",
    tag: "Anonymous desks · ZK",
    title: "Share across desks without saying who.",
    body: "A Semaphore proof shows that a desk member approved, without revealing which one. Only compliance can reveal the identity, on its own Ledger, and that leaves a trace.",
    cursor: "Prove",
    watermark: "ZK",
    tone: "bg-night-2 text-[#c4cee2]",
    art: "zk",
  },
];

/** Three moments of the demo, as tall pastel cards that shrink and drift as they scroll by. */
export function Moments() {
  return (
    <section id="moments" aria-labelledby="moments-title" className={`${SECTION_X} pb-[100px] md:pb-[140px]`}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <RevealText
          as="h2"
          id="moments-title"
          className="max-w-[14em] text-heading-lg"
          text="Three moments where trust is won or lost."
        />
        <TextLink href={DEMO_ROUTE}>See them in the demo</TextLink>
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
      className={`lp-moment relative isolate flex h-[min(560px,80svh)] flex-col overflow-hidden rounded-xl p-5 md:h-[min(620px,70svh)] md:p-7 ${moment.tone}`}
    >
      <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-meta">
        <span className="mono-label">
          {String(index + 1).padStart(2, "0")} / {String(MOMENTS.length).padStart(2, "0")}
        </span>
        <span className="lp-glass-tag rounded-pill border border-[#fff5] bg-[#ffffff65] px-[11px] py-[6px] text-[10px] md:px-[18px] md:py-[9px] md:text-[13px]">
          {moment.tag}
        </span>
        <span className="justify-self-end">{moment.id === "desks" ? "Desk mode" : "Demo"}</span>
      </div>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 -translate-y-1/2 text-center text-[140px] leading-none font-semibold tracking-[-0.08em] opacity-[0.055] select-none md:text-[clamp(120px,21vw,330px)]"
      >
        {moment.watermark}
      </span>

      <div className="lp-moment-art relative flex min-h-0 flex-1 items-center justify-center py-4">
        <div className="lp-moment-sculpture w-[min(440px,70%,36svh)] md:w-[min(520px,46%,48svh)]">
          {moment.art === "zk" ? (
            <ZkSculpture />
          ) : (
            <PlaceholderImage
              slot={moment.art.slot}
              alt={moment.art.alt}
              hideWatermark
              className="rounded-3xl"
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
  const members = Array.from({ length: 3 }, (_, i) => i);
  return (
    <div role="img" aria-label="Three desk members orbiting a zero-knowledge proof." className="lp-zk">
      <div className="lp-zk-orbit">
        {members.map((i) => (
          <span key={i} className="lp-zk-member" style={{ "--k": i } as React.CSSProperties} />
        ))}
      </div>
      <div className="lp-zk-core">
        <span className="mono-chip text-signal">ZK proof</span>
        <span className="mt-2 text-[12px] opacity-70">1 of 3 · anonymous</span>
      </div>
    </div>
  );
}
