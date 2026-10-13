"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRef, useSyncExternalStore } from "react";
import { BadgeMark } from "@/components/brand";
import { NudgeArrow, RollingText, SpinPlus } from "@/components/motion/rolling-text";
import { DemoLink, GITHUB_URL, SHOWCASE } from "./primitives";

const MENU_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#moments", label: "Key moments" },
  { href: "#trust", label: "Security & attestation" },
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
        <div className="flex items-center gap-1 justify-self-end">
          <ThemeSwitch />
          <DemoLink className="lp-nav-action inline-flex items-center gap-2 rounded-pill px-[11px] py-[9px] text-[11px] font-semibold transition-colors duration-300 md:px-[15px] md:py-[10px] md:text-[12px]">
            <RollingText>Demo</RollingText>
            <NudgeArrow />
          </DemoLink>
        </div>
      </nav>

      <dialog
        ref={dialogRef}
        aria-labelledby="nav-dialog-title"
        className="lp-nav-dialog mx-auto mt-[92px] w-[min(760px,calc(100%-24px))] rounded-3xl bg-[var(--lp-dialog-bg)] p-5 text-ink md:p-7"
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex items-center justify-between">
          <p id="nav-dialog-title" className="text-[12px] text-[var(--lp-dialog-muted)]">
            Badge · consent-based company memory
          </p>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="lp-close inline-flex size-[42px] items-center justify-center rounded-full border border-[var(--lp-control-line)] text-[28px] leading-none font-normal"
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
                className="flex items-center justify-between border-b border-[var(--lp-dialog-line)] py-[15px] text-[29px] leading-[1.2] tracking-[-0.055em] md:text-[clamp(26px,4vw,44px)]"
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
          <DemoLink className="lp-nav-action inline-flex min-h-12 items-center gap-6 rounded-pill px-6 text-[14px] font-semibold transition-colors duration-300">
            <RollingText>{SHOWCASE ? "Watch the demo" : "Open the demo"}</RollingText>
            <NudgeArrow />
          </DemoLink>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center gap-6 rounded-pill border border-[var(--lp-control-line)] px-6 text-[14px] font-semibold"
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

const subscribeNothing = (): (() => void) => () => {};

/**
 * Light / dark switch of the landing, through next-themes like the app's `ThemeToggle`. The icons
 * swap with the `dark` class (no hydration mismatch); the label names the action, so it waits for
 * the client, where the resolved theme is known.
 */
function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const dark = hydrated && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="lp-theme-toggle inline-flex size-[38px] items-center justify-center rounded-pill md:size-[42px]"
    >
      <Moon aria-hidden="true" className="size-[17px] dark:hidden" />
      <Sun aria-hidden="true" className="hidden size-[17px] dark:block" />
    </button>
  );
}
