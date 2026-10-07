/**
 * Before the web demo (`pnpm desks:seed`): David and Emma, the other members of the Research desk, join it with
 * their own Speculos Ledgers (infra/speculos.sh, ports 5004 and 5005), so that once Bob joins from the web app the
 * desk has 3 Ledger-joined members, the minimum the enclave requires before anyone may ask it (anonymity set).
 * Every review on their devices is approved automatically: it is setup, not part of what the audience watches.
 *
 * Enclave: BADGE_ENCLAVE_URL (default http://127.0.0.1:8787). A loopback enclave is attested in simulated mode,
 * any other in tdx mode with the pins of BADGE_ENCLAVE_OS_MEASUREMENTS_FILE (see @badge/client enclavePinsFromEnv).
 * Idempotent: a member who already joined is left as is.
 */
import { readFileSync } from "node:fs";
import { BadgeClient, enclavePinsFromEnv } from "@badge/client";
import type { AttestationMode } from "@badge/attest";
import type { LocalAccount } from "viem";
import { DemoLedger } from "./demo-support";
import { enrollAndJoinDesk, loadPeople, OTHER_RESEARCH_MEMBERS, RESEARCH_DESK } from "./desk-members";

const DEFAULT_ENCLAVE_URL = "http://127.0.0.1:8787";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

async function main(): Promise<void> {
  const baseUrl = (process.env["BADGE_ENCLAVE_URL"] ?? DEFAULT_ENCLAVE_URL).replace(/\/+$/, "");
  const attestationMode: AttestationMode = LOOPBACK_HOSTS.has(new URL(baseUrl).hostname)
    ? "simulated"
    : "tdx";
  const pins = enclavePinsFromEnv(process.env, attestationMode, (path) => readFileSync(path, "utf8"));
  const client = (sessionKey?: LocalAccount) =>
    new BadgeClient({
      baseUrl,
      transport: "channel",
      attestationMode,
      ...pins,
      ...(sessionKey === undefined ? {} : { sessionKey }),
    });
  const { enclaveMeasurement } = await client().connect();
  console.log(`enclave ${baseUrl} attested (${attestationMode}), measurement ${enclaveMeasurement}`);

  const { company, people } = loadPeople(OTHER_RESEARCH_MEMBERS);
  for (const who of OTHER_RESEARCH_MEMBERS) {
    const ledger = await DemoLedger.connect(who, people[who].address);
    try {
      const desk = await enrollAndJoinDesk({
        client,
        ledger,
        person: people[who],
        company,
        measurement: enclaveMeasurement,
        desk: RESEARCH_DESK,
      });
      console.log(`${people[who].name} a rejoint le desk ${desk.name} : ${desk.members} membre(s) Ledger.`);
    } finally {
      await ledger.close();
    }
  }
}

main().then(
  // The Ledger transport keeps timers alive after its sessions are closed: exit explicitly.
  () => process.exit(0),
  (error: unknown) => {
    console.error(`seed-desks FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
