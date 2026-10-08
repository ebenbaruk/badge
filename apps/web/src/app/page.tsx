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
import { TechStrip } from "@/components/landing/tech-strip";
import { Trust } from "@/components/landing/trust";
import "@/components/landing/landing.css";

const DESCRIPTION =
  "Badge : la mémoire d'entreprise pour les agents, dans une enclave attestée. Chaque extrait du contexte d'un collègue n'en sort qu'avec sa signature sur son Ledger.";

export const metadata: Metadata = {
  title: { absolute: "Badge · Le Ledger, badge d'entreprise de l'ère des agents" },
  description: DESCRIPTION,
  openGraph: {
    title: "Badge · Votre contexte. Votre accord.",
    description: DESCRIPTION,
    locale: "fr_FR",
    type: "website",
  },
};

/** Public landing page. The demo itself lives under `/demo` (Alice, Bob and Chloé's screens). */
export default function Landing() {
  return (
    <div className="lp">
      <a href="#contenu" className="lp-skip">
        Aller au contenu
      </a>
      <NavPill />
      <main id="contenu">
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
