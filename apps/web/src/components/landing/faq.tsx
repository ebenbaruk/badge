import { RevealText } from "@/components/motion/reveal-text";
import { GITHUB_URL, SECTION_X, TextLink } from "./primitives";

const QUESTIONS = [
  {
    q: "Où vivent les données ?",
    a: "Dans l'enclave : une machine virtuelle confidentielle Intel TDX sur Phala, qui garde la mémoire, la politique et le journal. Le serveur web et l'agent ne reçoivent que ce que l'enclave leur remet : un brief, avec la provenance de chaque extrait.",
  },
  {
    q: "Que voit le modèle de langage ?",
    a: "Seulement les extraits nécessaires à une tâche, une fois autorisés, envoyés par la passerelle unique vers Phala Confidential AI. Le contexte complet d'un collègue n'est jamais envoyé au modèle.",
  },
  {
    q: "Pourquoi un Ledger ?",
    a: "Parce que son écran est hors de portée de l'agent, du navigateur et du serveur. Grâce au clear signing (EIP-712), ce que le propriétaire lit est exactement ce qu'il signe, et l'enclave vérifie cette signature avant de libérer quoi que ce soit.",
  },
  {
    q: "Mes équipes vont-elles valider toute la journée ?",
    a: "Non : les accords permanents couvrent les usages récurrents (une équipe, un usage, une durée, une taille maximale par extrait). Ils sont signés une fois, révocables, et chaque usage est journalisé.",
  },
  {
    q: "Que se passe-t-il quand je révoque ?",
    a: "La révocation est signée sur le Ledger et appliquée par l'enclave : tout usage suivant est refusé. Ce qui a déjà été remis à un agent ne peut pas être repris, c'est pourquoi l'accord se donne extrait par extrait.",
  },
  {
    q: "Comment savoir que c'est la bonne enclave ?",
    a: "Chaque client vérifie l'attestation Intel avant d'échanger : TCB, compose hash, app id et mesures de l'image. Cette mesure figure aussi dans chaque message que le Ledger affiche et signe.",
  },
  {
    q: "Et l'anonymat entre desks ?",
    a: "Un desk partage avec une preuve Semaphore : elle montre qu'un membre inscrit a accepté, sans dire lequel, à partir de trois membres. La conformité peut lever l'anonymat avec son propre Ledger, et cette levée est journalisée.",
  },
  {
    q: "Ça marche avec nos agents ?",
    a: "Oui. Badge se branche sur la harness de chaque employé par un serveur MCP local. L'agent peut demander et suivre une tâche, jamais approuver à la place de l'humain.",
  },
] as const;

/** FAQ: native `<details>` with an animated height (Chromium) and a +/− marker. */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className={`${SECTION_X} pb-[100px] md:pb-[140px]`}>
      <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:gap-20">
        <div>
          <RevealText
            as="h2"
            id="faq-title"
            className="text-[clamp(38px,4vw,60px)] leading-[1.05] tracking-[-0.06em]"
            text="Les questions des RSSI."
          />
          <p className="mt-4 text-[14px] text-ink-muted-2">
            Ce que vos équipes sécurité et conformité demanderont en premier.
          </p>
          <TextLink href={GITHUB_URL} className="mt-6">
            Lire le code
          </TextLink>
        </div>
        <div className="lp-faq">
          {QUESTIONS.map(({ q, a }) => (
            <details key={q} className="border-b border-[#c5c9d2] first:border-t">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[16px] [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden="true" className="lp-faq-mark font-mono text-[23px] leading-none" />
              </summary>
              <p className="max-w-[40em] pb-6 text-[15px] leading-relaxed text-ink-muted-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
