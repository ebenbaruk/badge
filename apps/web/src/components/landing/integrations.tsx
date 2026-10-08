import { Reveal } from "@/components/motion/reveal";
import { RevealText } from "@/components/motion/reveal-text";
import { EditorialGrid, GITHUB_URL, SECTION_X, TextLink } from "./primitives";

/** The four tools of Badge's MCP server (`apps/mcp`). */
const TOOLS = [
  {
    name: "badge_get_context",
    body: "Requests context for a task: the brief and its provenance, or the pending consents.",
  },
  { name: "badge_task_status", body: "Tracks the task; returns the brief once nothing is pending." },
  { name: "badge_list_my_consents", body: "Lists the requests received. The agent can't approve them." },
  {
    name: "badge_attestation",
    body: "Enclave measurement, checked against the one signed into the session.",
  },
] as const;

/** Integrations: Badge plugs into each employee's own agent harness through MCP. */
export function Integrations() {
  return (
    <section
      id="integrations"
      aria-labelledby="integrations-title"
      className={`${SECTION_X} pb-[100px] md:pb-[140px]`}
    >
      <EditorialGrid aside="Integrations">
        <RevealText
          as="h2"
          id="integrations-title"
          className="text-heading-lg"
          text="Inside your agent harness."
        />
        <Reveal as="p" delay={100} className="mt-6 max-w-[36em] text-lede text-ink-muted-2">
          Everyone keeps their own tools. Badge plugs into each employee&apos;s agent through a local MCP
          server: four tools, and always the same rule. The agent asks, the human signs.
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
              aria-label="Exchange between Alice's agent and Badge"
              className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.8] md:p-6 md:text-[13px]"
            >
              <code>
                <span className="text-[#8a90a0]">{"› "}</span>
                <span className="text-paper">
                  Prepare the brief for tomorrow&apos;s meeting with client Orion
                </span>
                {"\n\n"}
                <span className="text-signal">badge_get_context</span>
                {' { taskLabel: "Orion brief" }\n'}
                <span className="text-[#a8a0f4]">
                  {"  ⏳ waiting for Bob Durand's consent on his Ledger\n\n"}
                </span>
                <span className="text-signal">badge_task_status</span>
                {' { taskId: "t_42" }\n'}
                <span className="text-[#89e0b0]">
                  {"  ✓ brief ready · 3 excerpts · consent signed on Ledger\n"}
                </span>
                <span className="text-[#8a90a0]">
                  {"  provenance: Bob's notes (signed), company context"}
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
          Connect Badge to your agent
        </TextLink>
      </EditorialGrid>
    </section>
  );
}
