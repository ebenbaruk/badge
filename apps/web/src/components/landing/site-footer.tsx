import Link from "next/link";
import { BadgeMark } from "@/components/brand";
import { NudgeArrow, RollingText } from "@/components/motion/rolling-text";
import { RevealText } from "@/components/motion/reveal-text";
import { DEMO_ROUTE, GITHUB_URL } from "./primitives";
import { ScrollScene } from "./scroll-scene";

const FOOTER_LINKS = [
  { href: GITHUB_URL, label: "GitHub" },
  { href: `${GITHUB_URL}/blob/main/README.md`, label: "README" },
  { href: `${GITHUB_URL}/blob/main/INSTALL.md`, label: "Run the demo" },
] as const;

/** Night footer: invitation, giant drifting wordmark and the hackathon credits. */
export function SiteFooter() {
  return (
    <ScrollScene
      as="footer"
      className="lp-footer overflow-hidden bg-night px-4 pt-[72px] pb-6 text-paper md:px-[26px]"
    >
      <div className="mx-auto grid max-w-[1700px] gap-8 md:grid-cols-[1.4fr_1fr] md:items-end">
        <RevealText
          as="p"
          className="text-[clamp(30px,4vw,60px)] leading-[1.08] tracking-[-0.06em]"
          text="Context flows. Consent stays with its owner."
        />
        <Link
          href={DEMO_ROUTE}
          className="inline-flex items-center gap-4 justify-self-start text-[clamp(18px,2.5vw,36px)] tracking-[-0.04em] text-signal md:justify-self-end"
        >
          <RollingText>Open the demo</RollingText>
          <NudgeArrow />
        </Link>
      </div>

      <div
        aria-hidden="true"
        className="lp-wordmark mx-auto mt-16 flex max-w-[1100px] items-center justify-center gap-[0.12em] text-[clamp(96px,21vw,330px)] leading-none font-semibold tracking-[-0.08em] md:mt-24"
      >
        <BadgeMark className="size-[0.72em] shrink-0" />
        <span>Badge</span>
      </div>

      <div className="mx-auto mt-12 flex max-w-[1700px] flex-col gap-4 border-t border-[#ffffff30] pt-5 text-[11px] text-[#c4cee2] md:flex-row md:items-center md:justify-between">
        <p>Ledger N3XT Hackathon @ OP3N 2026 · Team DVB</p>
        <ul className="flex flex-wrap gap-5">
          {FOOTER_LINKS.map((link) => (
            <li key={link.label}>
              <a href={link.href} target="_blank" rel="noreferrer" className="hover:underline">
                {link.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
          <li>
            <a href="#top" className="hover:underline">
              Back to top ↑
            </a>
          </li>
        </ul>
      </div>
    </ScrollScene>
  );
}
