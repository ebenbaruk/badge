import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { Stagger } from "@/components/motion/stagger";
import { PlaceholderImage } from "./placeholder-image";
import { GITHUB_URL, SECTION_X, TextLink } from "./primitives";

const PILLARS = [
  {
    chip: "Intel TDX · Phala dstack",
    title: "Une enclave matérielle",
    body: "Mémoire, politique et journal vivent dans une machine virtuelle confidentielle. L'hébergeur ne voit que de la mémoire chiffrée ; journaux et infos système ne sont pas publics.",
  },
  {
    chip: "Attestation",
    title: "Vérifiée à chaque canal",
    body: "Avant tout échange, le client vérifie la quote Intel, le TCB, le compose hash, l'app id et les mesures de l'image. Cette mesure est aussi signée dans chaque message Ledger.",
  },
  {
    chip: "Passerelle unique",
    title: "Une seule sortie réseau",
    body: "La seule route vers l'extérieur est une passerelle figée dans la configuration attestée, qui ne joint que le LLM confidentiel. Le déployeur ne peut pas la rediriger.",
  },
  {
    chip: "Confidential AI",
    title: "Un LLM confidentiel",
    body: "Seuls les extraits nécessaires à une tâche partent vers Phala Confidential AI, exécuté dans un TEE GPU. Jamais le contexte complet d'un collègue.",
  },
] as const;

const PROOFS = [
  {
    slot: "consent-receipt",
    alt: "Reçu d'accord signé : carte papier avec un tampon bleu.",
    title: "Le reçu d'accord",
    caption: "Message EIP-712 signé sur le Ledger, vérifié par l'enclave avant de libérer l'extrait.",
  },
  {
    slot: "attestation-report",
    alt: "Rapport d'attestation : tablette de verre et anneaux d'orbite.",
    title: "Le rapport d'attestation",
    caption: "Quote Intel TDX, compose hash et mesures épinglées, rejoués par chaque client.",
  },
] as const;

/** Trust architecture on a royal-blue panel: four guarantees, the attestation seal and the proofs. */
export function Trust() {
  return (
    <section id="confiance" aria-labelledby="trust-title" className={`${SECTION_X} pb-[100px] md:pb-[140px]`}>
      <div className="relative overflow-hidden rounded-4xl bg-brand-deep px-5 py-14 text-paper md:px-12 md:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="mono-label text-[#a7c8ff]">Architecture de confiance</p>
            <RevealText
              as="h2"
              id="trust-title"
              className="mt-5 text-heading-lg"
              text="Une enclave que chacun peut vérifier."
            />
            <Reveal as="p" delay={100} className="mt-6 max-w-[34em] text-lede text-[#c4cee2]">
              Badge ne demande pas de faire confiance à un serveur : il le prouve. Le code qui manipule le
              contexte est mesuré, attesté par Intel, et cette mesure est affichée sur chaque Ledger au moment
              de signer.
            </Reveal>
          </div>
          <AttestationSeal />
        </div>

        <Stagger as="ul" className="mt-14 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" step={90}>
          {PILLARS.map((pillar) => (
            <div
              key={pillar.title}
              className="h-full rounded-lg border border-[#ffffff26] bg-[#ffffff0d] p-6"
            >
              <span className="mono-chip text-signal">{pillar.chip}</span>
              <h3 className="mt-4 text-[22px] leading-tight tracking-[-0.04em]">{pillar.title}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-[#c4cee2]">{pillar.body}</p>
            </div>
          ))}
        </Stagger>

        <div className="mt-20 grid gap-10 md:grid-cols-[1fr_2.4fr] md:gap-[60px]">
          <p className="text-[12px] text-[#a7c8ff] md:text-[14px]">Exemple</p>
          <div>
            <RevealText as="h3" className="text-heading-md" text="Chaque accord laisse une preuve." />
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              {PROOFS.map((proof) => (
                <Reveal as="figure" key={proof.slot}>
                  <div className="overflow-hidden rounded-lg ring-1 ring-[#ffffff26]">
                    <PlaceholderImage slot={proof.slot} alt={proof.alt} />
                  </div>
                  <figcaption className="mt-4">
                    <strong className="block text-[15px] font-semibold">{proof.title}</strong>
                    <span className="mt-1 block text-[13px] text-[#c4cee2]">{proof.caption}</span>
                  </figcaption>
                </Reveal>
              ))}
            </div>
            <TextLink href={`${GITHUB_URL}/blob/main/docs/ARCHITECTURE.md`} className="mt-10 text-paper">
              Lire l&apos;architecture
            </TextLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Dashed seal inside orbit rings: the measurement that every Ledger shows before signing. */
function AttestationSeal() {
  return (
    <div
      className="lp-seal-stage relative mx-auto grid aspect-square w-[min(360px,80vw)] place-items-center"
      aria-hidden="true"
    >
      <span className="lp-orbit lp-orbit-a" />
      <span className="lp-orbit lp-orbit-b" />
      <span className="lp-orbit lp-orbit-c" />
      <Reveal y={0} className="lp-stamp-host">
        <span className="lp-seal">
          <b>ATTESTE</b>
          <small>Intel TDX</small>
          <code>0x9f2b...77d4</code>
        </span>
      </Reveal>
    </div>
  );
}
