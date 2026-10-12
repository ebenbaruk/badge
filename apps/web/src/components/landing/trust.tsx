import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { Stagger } from "@/components/motion/stagger";
import { EXAMPLE_MEASUREMENT, shortHash } from "./example";
import { GITHUB_URL, SECTION_X, TextLink } from "./primitives";

const PILLARS = [
  {
    chip: "Intel TDX · Phala dstack",
    title: "A hardware enclave",
    body: "Memory, policy and log live in a confidential virtual machine. The host only sees encrypted memory; logs and system info are never public.",
  },
  {
    chip: "Attestation",
    title: "Verified on every channel",
    body: "Before any exchange, the client checks the Intel quote, the TCB, the compose hash, the app id and the image measurements. That measurement is also signed into every Ledger message.",
  },
  {
    chip: "Single gateway",
    title: "One way out",
    body: "The only route to the outside is a gateway pinned in the attested configuration, and it only reaches the confidential LLM. The deployer can't redirect it.",
  },
  {
    chip: "Confidential AI",
    title: "A confidential LLM",
    body: "Only the excerpts a task needs go to Phala's confidential AI service, the only address the enclave can reach.",
  },
] as const;

/** Trust architecture on a royal-blue panel: four guarantees and the attestation seal. */
export function Trust() {
  return (
    <section id="trust" aria-labelledby="trust-title" className={`${SECTION_X} pb-[100px] md:pb-[140px]`}>
      <div className="relative overflow-hidden rounded-4xl bg-brand-deep px-5 py-14 text-paper md:px-12 md:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr] lg:items-center">
          <div>
            <p className="mono-label text-[#a7c8ff]">Trust architecture</p>
            <RevealText
              as="h2"
              id="trust-title"
              className="mt-5 text-heading-lg"
              text="An enclave anyone can verify."
            />
            <Reveal as="p" delay={100} className="mt-6 max-w-[34em] text-lede text-[#c4cee2]">
              Badge&apos;s memory lives in the cloud and knows everyone&apos;s context, so it doesn&apos;t ask
              for trust: it proves it. The code that handles context is measured and attested by Intel, and
              that measurement appears on every Ledger at signing time.
            </Reveal>
            <TextLink href={`${GITHUB_URL}/blob/main/README.md`} className="mt-8 text-paper">
              Read the README
            </TextLink>
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
          <b>Attested</b>
          <small>Intel TDX</small>
          <code>{shortHash(EXAMPLE_MEASUREMENT)}</code>
        </span>
      </Reveal>
    </div>
  );
}
