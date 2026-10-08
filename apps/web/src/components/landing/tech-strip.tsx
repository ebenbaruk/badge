import { Marquee } from "@/components/motion/marquee";
import { SECTION_X } from "./primitives";

const BUILDING_BLOCKS = [
  "Ledger DMK",
  "Clear Signing",
  "EIP-712",
  "Ledger Flex",
  "Phala Cloud",
  "dstack",
  "Intel TDX",
  "Confidential AI",
  "Semaphore",
  "Honcho",
  "MCP",
  "Next.js",
] as const;

/** Illustrative journal lines: every use of a standing agreement is logged. */
const AUDIT_LINES = [
  "14:02 · brief Orion · Alice ← notes de Bob · signe 0x3a9f…c21e",
  "14:05 · agent compromis · tout le contexte de Bob · refuse",
  "14:11 · accord permanent · Ventes · notes clients · 30 j",
  "14:20 · usage · accord permanent #7 · journalise",
  "14:26 · revocation · Bob → Alice · signe 0x71c0…9ab2",
  "14:31 · desk Research · preuve ZK · 1 sur 3",
] as const;

/** Credibility strip: the building blocks, then a slower reverse ticker of journal lines. */
export function TechStrip() {
  return (
    <section aria-labelledby="tech-title" className="pb-[100px] md:pb-[140px]">
      <div className={SECTION_X}>
        <h2 id="tech-title" className="text-meta text-ink-muted-2">
          Construit sur des briques ouvertes et vérifiables.
        </h2>
      </div>
      <Marquee label="Technologies utilisées par Badge" showPauseButton className={`${SECTION_X} mt-4`}>
        {BUILDING_BLOCKS.map((name) => (
          <span
            key={name}
            className="text-[clamp(27px,3vw,45px)] leading-none font-semibold tracking-[-0.05em] whitespace-nowrap"
          >
            {name}
          </span>
        ))}
      </Marquee>
      <Marquee
        label="Exemple de journal d'audit"
        reverse
        duration={70}
        gap={56}
        className="mt-8 text-ink-muted"
      >
        {AUDIT_LINES.map((line) => (
          <span key={line} className="font-mono text-[12px] whitespace-nowrap">
            {line}
          </span>
        ))}
      </Marquee>
    </section>
  );
}
