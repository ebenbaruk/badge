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
    title: "Company context",
    description: "The business, its clients, its news: available to every agent, without friction.",
    action: "See the flow",
    href: "#how-it-works",
  },
  {
    slot: "tile-personal",
    title: "Personal context",
    description: "Each employee's notes and meetings. An excerpt only leaves with its owner's consent.",
    action: "Key moments",
    href: "#moments",
  },
  {
    slot: "tile-consent",
    title: "Signed consent",
    description: "One-off or standing, read and signed on the Ledger, revocable, logged on every use.",
    action: "The Ledger screen",
    href: "#how-it-works",
  },
  {
    slot: "tile-enclave",
    title: "Attested enclave",
    description: "Intel TDX on Phala: the cloud sees nothing, and every client verifies the code it runs.",
    action: "The architecture",
    href: "#trust",
  },
];

/** "Explore": four entry points into the page, each with a pastel tile. */
export function JumpGrid() {
  return (
    <section aria-labelledby="jump-title" className={`${SECTION_X} pb-[100px] md:pb-[140px]`}>
      <EditorialGrid aside={<span id="jump-title">Explore</span>}>
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
