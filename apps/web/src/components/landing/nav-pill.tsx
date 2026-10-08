"use client";

import Link from "next/link";
import { useRef } from "react";
import { BadgeMark } from "@/components/brand";
import { NudgeArrow, RollingText, SpinPlus } from "@/components/motion/rolling-text";
import { DEMO_ROUTE, GITHUB_URL } from "./primitives";

const MENU_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#moments", label: "Key moments" },
  { href: "#trust", label: "Security & attestation" },
  { href: "#integrations", label: "In your harness" },
  { href: "#faq", label: "FAQ" },
] as const;

/**
 * Floating glass pill (menu, mark, demo) that drops in on load. The menu is a native modal
 * `<dialog>`: focus trap, Escape and the backdrop come from the browser.
 */
export function NavPill() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="glass animate-nav-arrive fixed inset-x-0 top-[22px] z-40 mx-auto grid w-[min(440px,calc(100%-32px))] grid-cols-[1fr_auto_1fr] items-center rounded-pill px-2 py-[5px] text-ink shadow-nav"
      >
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-2 justify-self-start rounded-pill px-[11px] py-[11px] text-[11px] font-semibold md:px-[15px] md:py-3 md:text-[12px]"
        >
          <RollingText>Product</RollingText>
          <SpinPlus className="text-[18px] leading-none" />
        </button>
        <a href="#top" aria-label="Badge, back to top" className="rounded-[10px]">
          <BadgeMark className="size-10 md:size-11" />
        </a>
        <Link
          href={DEMO_ROUTE}
          className="inline-flex items-center gap-2 justify-self-end rounded-pill bg-graphite px-[11px] py-[9px] text-[11px] font-semibold text-paper transition-colors duration-300 hover:bg-brand-deep md:px-[15px] md:py-[10px] md:text-[12px]"
        >
          <RollingText>Demo</RollingText>
          <NudgeArrow />
        </Link>
      </nav>

      <dialog
        ref={dialogRef}
        aria-labelledby="nav-dialog-title"
        className="lp-nav-dialog mx-auto mt-[92px] w-[min(760px,calc(100%-24px))] rounded-3xl bg-[#eff1f5] p-5 text-ink md:p-7"
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex items-center justify-between">
          <p id="nav-dialog-title" className="text-[12px] text-[#595b61]">
            Badge · consent-based company memory
          </p>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="lp-close inline-flex size-[42px] items-center justify-center rounded-full border border-[#c6c8cc] text-[28px] leading-none font-normal"
          >
            ×
          </button>
        </div>
        <ul className="mt-4">
          {MENU_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={close}
                className="flex items-center justify-between border-b border-[#cdd0d6] py-[15px] text-[29px] leading-[1.2] tracking-[-0.055em] md:text-[clamp(26px,4vw,44px)]"
              >
                <RollingText>{link.label}</RollingText>
                <span aria-hidden="true" className="text-[28px]">
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href={DEMO_ROUTE}
            className="inline-flex min-h-12 items-center gap-6 rounded-pill bg-graphite px-6 text-[14px] font-semibold text-paper transition-colors duration-300 hover:bg-brand-deep"
          >
            <RollingText>Open the demo</RollingText>
            <NudgeArrow />
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center gap-6 rounded-pill border border-[#c6c8cc] px-6 text-[14px] font-semibold"
          >
            <RollingText>Source code</RollingText>
            <NudgeArrow />
            <span className="sr-only"> (GitHub, opens in a new tab)</span>
          </a>
        </div>
      </dialog>
    </>
  );
}
