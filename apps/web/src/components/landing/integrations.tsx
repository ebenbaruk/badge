import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { EditorialGrid, GITHUB_URL, SECTION_X, TextLink } from "./primitives";

/** The four tools of Badge's MCP server (`apps/mcp`). */
const TOOLS = [
  {
    name: "badge_get_context",
    body: "Demande le contexte d'une tâche : brief et provenance, ou les accords en attente.",
  },
  { name: "badge_task_status", body: "Suit la tâche ; renvoie le brief dès que plus rien n'est en attente." },
  { name: "badge_list_my_consents", body: "Liste les demandes reçues. L'agent ne peut pas les approuver." },
  { name: "badge_attestation", body: "Mesure de l'enclave, comparée à celle signée dans la session." },
] as const;

/** Integrations: Badge plugs into each employee's own agent harness through MCP. */
export function Integrations() {
  return (
    <section
      id="integrations"
      aria-labelledby="integrations-title"
      className={`${SECTION_X} pb-[100px] md:pb-[140px]`}
    >
      <EditorialGrid aside="Intégrations">
        <RevealText
          as="h2"
          id="integrations-title"
          className="text-heading-lg"
          text="Dans votre harness d'agent."
        />
        <Reveal as="p" delay={100} className="mt-6 max-w-[36em] text-lede text-ink-muted-2">
          Chacun garde ses outils. Badge se branche sur l&apos;agent de chaque employé par un serveur MCP
          local : quatre outils, et toujours la même règle, l&apos;agent demande, l&apos;humain signe.
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Reveal className="overflow-hidden rounded-xl bg-night text-[#c4cee2]">
            <div className="flex items-center gap-2 border-b border-[#ffffff1a] px-5 py-3">
              <span className="size-2.5 rounded-full bg-[#ffffff26]" />
              <span className="size-2.5 rounded-full bg-[#ffffff26]" />
              <span className="size-2.5 rounded-full bg-[#ffffff26]" />
              <span className="mono-label ml-3 text-[#8a90a0]">agent · alice</span>
            </div>
            {/* Focusable so keyboard users can scroll the transcript on narrow screens. */}
            <pre
              tabIndex={0}
              role="region"
              aria-label="Échange entre l'agent d'Alice et Badge"
              className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.8] md:p-6 md:text-[13px]"
            >
              <code>
                <span className="text-[#8a90a0]">{"› "}</span>
                <span className="text-paper">Prépare le brief du rendez-vous Orion</span>
                {"\n\n"}
                <span className="text-signal">badge_get_context</span>
                {' { taskLabel: "brief Orion" }\n'}
                <span className="text-[#a8a0f4]">
                  {"  ⏳ en attente de l'accord de Bob Durand sur son Ledger\n\n"}
                </span>
                <span className="text-signal">badge_task_status</span>
                {' { taskId: "t_42" }\n'}
                <span className="text-[#89e0b0]">
                  {"  ✓ brief prêt · 3 extraits · accord signé sur Ledger\n"}
                </span>
                <span className="text-[#8a90a0]">
                  {"  provenance : notes de Bob (signé), contexte global"}
                </span>
              </code>
            </pre>
          </Reveal>

          <ul className="grid content-start">
            {TOOLS.map((tool) => (
              <li key={tool.name} className="border-b border-[#c5c9d2] py-[17px] first:border-t">
                <code className="font-mono text-[13px] font-semibold text-cobalt">{tool.name}</code>
                <p className="mt-1 text-[14px] text-ink-muted-2">{tool.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <TextLink href={`${GITHUB_URL}/tree/main/apps/mcp`} className="mt-10">
          Brancher Badge sur un agent
        </TextLink>
      </EditorialGrid>
    </section>
  );
}
