import type { Metadata } from "next";
import { ConsentStory } from "@/components/landing/consent-story";
import { DemoPanel } from "@/components/landing/demo-panel";
import { Faq } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { Intro } from "@/components/landing/intro";
import { Moments } from "@/components/landing/moments";
import { NavPill } from "@/components/landing/nav-pill";
import { SiteFooter } from "@/components/landing/site-footer";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Trust } from "@/components/landing/trust";
import "@/components/landing/landing.css";

const DESCRIPTION =
  "Badge: company memory for AI agents, sealed in an attested enclave. No excerpt of a colleague's context leaves without their signature on their Ledger.";

/** Alt text of the share image (.frontend/brand/og.json). */
const OG_IMAGE_ALT =
  "Badge: Badge is a company memory for AI agents, and it turns each employee's Ledger into their company badge.";

export const metadata: Metadata = {
  title: { absolute: "Badge · The Ledger, your company badge for the agent era" },
  description: DESCRIPTION,
  openGraph: {
    title: "Badge · Your context. Your consent.",
    description: DESCRIPTION,
    locale: "en_US",
    type: "website",
    images: [{ url: "/opengraph-image.4e110d9c.png", width: 1200, height: 630, alt: OG_IMAGE_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Badge · Your context. Your consent.",
    description: DESCRIPTION,
    images: [{ url: "/opengraph-image.4e110d9c.png", alt: OG_IMAGE_ALT }],
  },
};

/** Public landing page. The demo itself lives under `/demo` (Alice, Bob and Chloé's screens). */
export default function Landing() {
  return (
    <div className="lp">
      <SmoothScroll />
      <a href="#content" className="lp-skip">
        Skip to content
      </a>
      <NavPill />
      <main id="content">
        <Hero />
        <Intro />
        <ConsentStory />
        <Moments />
        <Trust />
        <DemoPanel />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
