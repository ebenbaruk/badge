/**
 * Prepares the web demo (`pnpm demo:prepare`), so that a presenter starts straight at the jury walkthrough: everything
 * the Setup page and the desk join would otherwise ask for, signed for real on each Speculos Ledger with every review
 * approved automatically (it is setup, not what the audience watches).
 *
 * - David and Emma enroll and join the Research desk (what `pnpm desks:seed` does);
 * - Alice, Bob and Chloe enroll and delegate a fresh agent session (8 hours) to their web agent;
 * - Bob joins the Research desk with his anonymous identity (the desk then has the 3 members the enclave requires),
 *   Alice her own Origination desk (so her Setup page is complete);
 * - Chloe registers her compliance key.
 *
 * The agent session keys are written where the web app's agent runtime restores them (apps/web/.data, or
 * BADGE_WEB_DATA_DIR): run this while the web server is stopped, since a running server keeps its own copy in memory
 * and would overwrite the file. `scripts/demo-web.sh` does it in that order. Re-running it is safe and is how
 * expired sessions are renewed: enrollment and session are signed again, desk and compliance steps already done are
 * left as they are.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  complianceKeyDeriveMessage,
  complianceKeyFromSignature,
  complianceKeyRegistrationMessage,
  type AttestationMode,
} from "@badge/attest";
import { BadgeApiError, BadgeClient, createAgentSession, enclavePinsFromEnv } from "@badge/client";
import {
  deskIdentityDeriveMessage,
  toDeviceAscii,
  toUnixSeconds,
  type BadgeMessageKind,
  type BadgeMessages,
  type SignedMessage,
} from "@badge/consent";
import { deriveDeskIdentity } from "@badge/zk";
import type { Hex, LocalAccount } from "viem";
import { EMPLOYEES as DIRECTORY } from "@/lib/directory";
import { AgentStore } from "@/server/agent-store";
import { DemoLedger, REPO_ROOT, type DemoEmployee } from "./demo-support";
import {
  enrollAndJoinDesk,
  loadPeople,
  OTHER_RESEARCH_MEMBERS,
  randomNonce,
  RESEARCH_DESK,
  type Person,
} from "./desk-members";

const DEFAULT_ENCLAVE_URL = "http://127.0.0.1:8787";
/** Where the web app keeps its agent runtime by default (apps/web/src/server/config.ts, relative to apps/web). */
const DEFAULT_WEB_DATA_DIR = resolve(REPO_ROOT, "apps/web/.data");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** The employees the presenter plays in the web demo. */
const PRESENTERS = ["alice", "bob", "chloe"] as const satisfies readonly DemoEmployee[];

async function signed<K extends BadgeMessageKind>(
  ledger: DemoLedger,
  kind: K,
  message: BadgeMessages[K],
): Promise<SignedMessage<K>> {
  return { kind, message, signature: (await ledger.sign(kind, message)).signature };
}

interface Context {
  readonly client: (sessionKey?: LocalAccount) => BadgeClient;
  readonly company: string;
  readonly measurement: Hex;
}

/** Enrolls `person` and delegates a fresh session to their web agent. Returns the agent client and its key. */
async function enrollWithWebAgent(
  ctx: Context,
  ledger: DemoLedger,
  person: Person,
  who: (typeof PRESENTERS)[number],
): Promise<{
  agent: BadgeClient;
  privateKey: Hex;
  session: Awaited<ReturnType<BadgeClient["openSession"]>>;
}> {
  const onboarding = ctx.client();
  await onboarding.enroll(
    await signed(ledger, "EmployeeEnroll", {
      company: ctx.company,
      employeeName: toDeviceAscii(person.name),
      team: toDeviceAscii(person.team),
      enclaveMeasurement: ctx.measurement,
      employee: person.address,
      issuedAt: toUnixSeconds(new Date()),
      nonce: randomNonce(),
    }),
  );
  // Same agent name and defaults (8 h, "Requests only") as the web app's "Authorize my agent" step.
  const { message, sessionKey, privateKey } = createAgentSession(person.address, {
    agentName: `${DIRECTORY[who].firstName}'s Badge agent`,
    enclaveMeasurement: ctx.measurement,
  });
  const session = await onboarding.openSession(await signed(ledger, "AgentSession", message));
  return { agent: ctx.client(sessionKey), privateKey, session };
}

/** Each presenter's own desk, joined with their anonymous identity (Chloe, compliance, belongs to none). */
const DESK_OF = { alice: { id: "origination", name: "Origination" }, bob: RESEARCH_DESK } as const;

async function joinDeskAnonymously(
  ctx: Context,
  ledger: DemoLedger,
  person: Person,
  agent: BadgeClient,
  desk: { readonly id: string; readonly name: string },
) {
  const identity = deriveDeskIdentity(await ledger.signPersonal(deskIdentityDeriveMessage(ctx.company)));
  try {
    return await agent.joinDesk(
      await signed(ledger, "DeskJoin", {
        deskName: desk.name,
        company: ctx.company,
        identityCommitment: identity.commitment,
        employee: person.address,
        nonce: randomNonce(),
      }),
    );
  } catch (error) {
    if (!(error instanceof BadgeApiError) || error.code !== "ALREADY_EXISTS") throw error;
    return agent.getDesk(desk.id);
  }
}

async function registerComplianceKey(ctx: Context, ledger: DemoLedger, agent: BadgeClient): Promise<string> {
  const existing = await agent.getComplianceKey();
  if (existing !== null) return "already registered";
  const derivation = await ledger.signPersonal(complianceKeyDeriveMessage(ctx.company));
  const publicKey = Buffer.from(complianceKeyFromSignature(derivation).publicKey).toString("hex");
  const signature = await ledger.signPersonal(complianceKeyRegistrationMessage(ctx.company, publicKey));
  await agent.registerComplianceKey({ publicKey, signature });
  return "registered";
}

async function withLedger<T>(
  who: DemoEmployee,
  person: Person,
  use: (ledger: DemoLedger) => Promise<T>,
): Promise<T> {
  const ledger = await DemoLedger.connect(who, person.address);
  try {
    return await use(ledger);
  } finally {
    await ledger.close();
  }
}

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

  const { company, people } = loadPeople([...PRESENTERS, ...OTHER_RESEARCH_MEMBERS]);
  const ctx: Context = { client, company, measurement: enclaveMeasurement };

  for (const who of OTHER_RESEARCH_MEMBERS) {
    const desk = await withLedger(who, people[who], (ledger) =>
      enrollAndJoinDesk({
        client,
        ledger,
        person: people[who],
        company,
        measurement: enclaveMeasurement,
        desk: RESEARCH_DESK,
      }),
    );
    console.log(`${people[who].name} is in the ${desk.name} desk (${desk.members} Ledger member(s)).`);
  }

  const store = new AgentStore(resolve(process.env["BADGE_WEB_DATA_DIR"] ?? DEFAULT_WEB_DATA_DIR));
  const runtime = store.load();
  for (const who of PRESENTERS) {
    const person = people[who];
    await withLedger(who, person, async (ledger) => {
      const { agent, privateKey, session } = await enrollWithWebAgent(ctx, ledger, person, who);
      const previous = runtime[who];
      runtime[who] = {
        tasks: [],
        deskRequests: [],
        ...previous,
        enrolledAt: new Date().toISOString(),
        agent: { privateKey, session },
      };
      const until = new Date(session.expiresAt * 1000).toLocaleString("en-US");
      console.log(`${person.name}: enrolled, agent session valid until ${until}.`);
      if (who === "alice" || who === "bob") {
        const desk = await joinDeskAnonymously(ctx, ledger, person, agent, DESK_OF[who]);
        console.log(`${person.name} is in the ${desk.name} desk (${desk.members} Ledger member(s)).`);
      }
      if (who === "chloe") {
        console.log(`${person.name}: compliance key ${await registerComplianceKey(ctx, ledger, agent)}.`);
      }
    });
  }
  // Saved once every Ledger step succeeded: a half-prepared runtime would point at sessions that never opened.
  store.save(runtime);
  console.log(`agent sessions saved to ${store.path}`);
}

main().then(
  // The Ledger transport keeps timers alive after its sessions are closed: exit explicitly.
  () => process.exit(0),
  (error: unknown) => {
    console.error(`prepare-demo FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
