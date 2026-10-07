/**
 * The attested CVM artifacts (infra/cvm/compose.yml and the gateway image's entrypoint) must pin where employees'
 * context goes: the LLM upstream is a literal of the measured code, never a deployer-chosen value.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PINNED_UPSTREAM = "https://inference.phala.com/v1";
const COMPOSE = readFileSync(
  fileURLToPath(new URL("../../../infra/cvm/compose.yml", import.meta.url)),
  "utf8",
);
const ENVSH = fileURLToPath(new URL("../../../infra/gateway/15-badge-upstream.envsh", import.meta.url));

/** Sources the gateway entrypoint script as nginx does, and prints the upstream it settled on. */
function gatewayUpstream(env: Record<string, string>) {
  const result = spawnSync(
    "sh",
    ["-c", `. "${ENVSH}" && echo "$BADGE_UPSTREAM_BASE_URL $BADGE_UPSTREAM_HOST"`],
    {
      env: { PATH: process.env["PATH"] ?? "", BADGE_UPSTREAM_API_KEY: "key", ...env },
      encoding: "utf8",
    },
  );
  return { status: result.status, stdout: result.stdout.trim() };
}

describe("CVM artifacts pin the LLM upstream", () => {
  it("no endpoint of the compose comes from a deployer variable", () => {
    const endpointLines = COMPOSE.split("\n").filter((line) => /(_URL|_HOST|_ENDPOINT):/.test(line));
    expect(endpointLines.length).toBeGreaterThan(0);
    for (const line of endpointLines) expect(line).not.toMatch(/\$\{/);
    expect(COMPOSE).toContain(`BADGE_UPSTREAM_BASE_URL: ${PINNED_UPSTREAM}`);
  });

  it("the gateway image forwards only to the pinned host and refuses any other", () => {
    expect(gatewayUpstream({})).toEqual({ status: 0, stdout: `${PINNED_UPSTREAM} inference.phala.com` });
    expect(gatewayUpstream({ BADGE_UPSTREAM_BASE_URL: `${PINNED_UPSTREAM}/` }).status).toBe(0);
    expect(gatewayUpstream({ BADGE_UPSTREAM_BASE_URL: "https://attacker.example/v1" }).status).toBe(1);
    expect(gatewayUpstream({ BADGE_UPSTREAM_HOST: "attacker.example" }).status).toBe(1);
    expect(gatewayUpstream({ BADGE_UPSTREAM_API_KEY: "" }).status).toBe(1);
  });
});
