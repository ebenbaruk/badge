import { RevealText } from "@/components/motion/reveal-text";
import { GITHUB_URL, SECTION_X, TextLink } from "./primitives";

const QUESTIONS = [
  {
    q: "Why not share everything, or lock it down with rules?",
    a: "Sharing everything leaks what should never leak, and rigid guardrails stop autonomous agents at every turn. Badge's memory knows all the context, injects only what a task needs (fewer tokens, better results) and asks the owner when it is personal.",
  },
  {
    q: "Where does the data live?",
    a: "In the enclave: an Intel TDX confidential virtual machine on Phala that holds the memory, the policy and the log. The web server and the agent only get what the enclave hands them: a brief, with the provenance of every excerpt.",
  },
  {
    q: "What does the language model see?",
    a: "Only the excerpts a task needs, once authorized, sent through the single gateway to Phala Confidential AI. A colleague's full context is never sent to the model.",
  },
  {
    q: "Why a Ledger?",
    a: "Because its screen is out of reach of the agent, the browser and the server. With clear signing (EIP-712), what the owner reads is exactly what they sign, and the enclave verifies that signature before releasing anything.",
  },
  {
    q: "Will my teams spend all day approving?",
    a: "No: standing agreements cover recurring uses (one team, one purpose, one duration, a maximum size per excerpt). They are signed once, revocable, and every use is logged.",
  },
  {
    q: "What happens when I revoke?",
    a: "The revocation is signed on the Ledger and enforced by the enclave: every later use is rejected. What an agent already received can't be taken back, which is why consent is given excerpt by excerpt.",
  },
  {
    q: "How do I know it's the right enclave?",
    a: "Every client verifies the Intel attestation before any exchange: TCB, compose hash, app id and image measurements. That measurement also appears in every message the Ledger displays and signs.",
  },
  {
    q: "What about anonymity between desks?",
    a: "A desk shares with a Semaphore proof: it shows that an enrolled member approved, without saying which one, once the desk has at least three members. Compliance can reveal the identity with its own Ledger, and that reveal is logged.",
  },
  {
    q: "Does it work with our agents?",
    a: "Yes. Badge plugs into each employee's harness through a local MCP server. The agent can request a task and follow it, but never approve in the human's place.",
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
            text="Questions your CISO will ask."
          />
          <p className="mt-4 text-[14px] text-ink-muted-2">
            What your security and compliance teams will want to know first.
          </p>
          <TextLink href={GITHUB_URL} className="mt-6">
            Read the code
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
