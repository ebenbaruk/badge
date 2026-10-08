import type { Metadata } from "next";
import { ConsentStory } from "@/components/landing/consent-story";
import { DemoPanel } from "@/components/landing/demo-panel";
import { Faq } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { Integrations } from "@/components/landing/integrations";
import { Intro } from "@/components/landing/intro";
import { JumpGrid } from "@/components/landing/jump-grid";
import { Moments } from "@/components/landing/moments";
import { NavPill } from "@/components/landing/nav-pill";
import { SiteFooter } from "@/components/landing/site-footer";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { TechStrip } from "@/components/landing/tech-strip";
import { Trust } from "@/components/landing/trust";
import "@/components/landing/landing.css";

const DESCRIPTION =
  "Badge: company memory for AI agents, sealed in an attested enclave. No excerpt of a colleague's context leaves without their signature on their Ledger.";

export const metadata: Metadata = {
  title: { absolute: "Badge · The Ledger, your company badge for the agent era" },
  description: DESCRIPTION,
  openGraph: {
    title: "Badge · Your context. Your consent.",
    description: DESCRIPTION,
    locale: "en_US",
    type: "website",
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
        <JumpGrid />
        <ConsentStory />
        <Moments />
        <Trust />
        <Integrations />
        <TechStrip />
        <DemoPanel />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
