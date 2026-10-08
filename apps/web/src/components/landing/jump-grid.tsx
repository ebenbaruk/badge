import { NudgeArrow } from "@/components/motion/rolling-text";
import { Stagger } from "@/components/motion/stagger";
import { type LandingImageSlot, PlaceholderImage } from "./placeholder-image";
import { EditorialGrid, SECTION_X } from "./primitives";

const ENTRIES: readonly {
  slot: LandingImageSlot;
  title: string;
  description: string;
  action: string;
  href: `#${string}`;
}[] = [
  {
    slot: "tile-global",
    title: "Contexte global",
    description: "L'entreprise, ses clients, ses actualités : accessible à tous les agents, sans friction.",
    action: "Voir le parcours",
    href: "#fonctionnement",
  },
  {
    slot: "tile-personal",
    title: "Contexte personnel",
    description:
      "Les notes et rendez-vous de chacun. Un extrait ne sort qu'avec l'accord de son propriétaire.",
    action: "Les moments clés",
    href: "#moments",
  },
  {
    slot: "tile-consent",
    title: "Accord signé",
    description: "Ponctuel ou permanent, lu et signé sur le Ledger, révocable, journalisé à chaque usage.",
    action: "L'écran du Ledger",
    href: "#fonctionnement",
  },
  {
    slot: "tile-enclave",
    title: "Enclave attestée",
    description: "Intel TDX sur Phala : le cloud ne voit rien, chaque client vérifie le code qui tourne.",
    action: "L'architecture",
    href: "#confiance",
  },
];

/** "À découvrir": four entry points into the page, each with a pastel tile. */
export function JumpGrid() {
  return (
    <section aria-labelledby="jump-title" className={`${SECTION_X} pb-[100px] md:pb-[140px]`}>
      <EditorialGrid aside={<span id="jump-title">À découvrir</span>}>
        <Stagger as="ul" className="grid gap-6 sm:grid-cols-2" step={80}>
          {ENTRIES.map((entry) => (
            <a
              key={entry.title}
              href={entry.href}
              className="group grid gap-[18px] max-sm:grid-cols-1 sm:grid-cols-[115px_1fr]"
            >
              <div className="overflow-hidden rounded-md max-sm:aspect-[1.35] sm:size-[115px]">
                <PlaceholderImage
                  slot={entry.slot}
                  hideWatermark
                  className="size-full transition-transform duration-[650ms] ease-out-soft group-hover:scale-[1.15] group-hover:-rotate-[8deg]"
                />
              </div>
              <div className="flex flex-col">
                <p className="text-[16px] font-semibold tracking-[-0.035em]">{entry.title}</p>
                <p className="mt-[5px] text-[13px] text-ink-muted-3">{entry.description}</p>
                <p className="mt-auto inline-flex gap-1 pt-[14px] text-[11px]">
                  {entry.action} <NudgeArrow />
                </p>
              </div>
            </a>
          ))}
        </Stagger>
      </EditorialGrid>
    </section>
  );
}
