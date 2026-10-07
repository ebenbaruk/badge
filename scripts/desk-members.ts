/**
 * How a desk member joins with their own Ledger, shared by the demo (scripts/demo.ts) and the web demo setup
 * (scripts/seed-desks.ts): enrollment, agent session, anonymous desk identity derived from a Ledger signature, then
 * the Ledger-signed DeskJoin. Every signature is a real one on the member's Speculos device, so no member of a desk
 * has an identity whose secret anyone else could derive.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadgeApiError, createAgentSession, type BadgeClient, type Desk } from "@badge/client";
import {
  deskIdentityDeriveMessage,
  toDeviceAscii,
  toUnixSeconds,
  type BadgeMessageKind,
  type BadgeMessages,
  type SignedMessage,
} from "@badge/consent";
import { deriveDeskIdentity } from "@badge/zk";
import { bytesToBigInt, getAddress, type Address, type Hex, type LocalAccount } from "viem";
import { z } from "zod";
import { REPO_ROOT, type DemoEmployee, type DemoLedger } from "./demo-support";

/** The Research members besides Bob: their Ledgers only ever join the desk (infra/speculos.sh, 5004 and 5005). */
export const OTHER_RESEARCH_MEMBERS = ["david", "emma"] as const satisfies readonly DemoEmployee[];
/** The Research desk: API id and the name signed in DeskJoin. */
export const RESEARCH_DESK = { id: "research", name: "Research" } as const;
const AGENT_NAME = "Badge setup";
const NONCE_BYTES = 32;

export interface Person {
  readonly id: DemoEmployee;
  readonly name: string;
  readonly team: string;
  readonly address: Address;
}

const SeedSchema = z.object({
  company: z.object({ name: z.string() }),
  employees: z.array(
    z.object({ id: z.string(), name: z.string(), team: z.string(), ledgerAddress: z.string().nullable() }),
  ),
});

/** The company name and the directory entries of `ids`, from infra/seed/acme.json (what the enclave loads). */
export function loadPeople<Id extends DemoEmployee>(
  ids: readonly Id[],
): { company: string; people: Record<Id, Person> } {
  const seed = SeedSchema.parse(JSON.parse(readFileSync(join(REPO_ROOT, "infra/seed/acme.json"), "utf8")));
  const people = {} as Record<Id, Person>;
  for (const id of ids) {
    const employee = seed.employees.find((e) => e.id === id);
    if (!employee?.ledgerAddress) throw new Error(`the seed has no Ledger address for ${id}`);
    people[id] = {
      id,
      name: employee.name,
      team: employee.team,
      address: getAddress(employee.ledgerAddress),
    };
  }
  return { company: seed.company.name, people };
}

export function randomNonce(): bigint {
  return bytesToBigInt(globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

/** A Ledger signature of a Badge message, as the SDK sends it. */
async function signed<K extends BadgeMessageKind>(
  ledger: DemoLedger,
  kind: K,
  message: BadgeMessages[K],
): Promise<SignedMessage<K>> {
  return { kind, message, signature: (await ledger.sign(kind, message)).signature };
}

export interface JoinOptions {
  /** Builds a client for the enclave under test, signing with `sessionKey` when given. */
  readonly client: (sessionKey?: LocalAccount) => BadgeClient;
  readonly ledger: DemoLedger;
  readonly person: Person;
  readonly company: string;
  /** Measurement of the attested enclave, pinned in every signed message. */
  readonly measurement: Hex;
  readonly desk: { readonly id: string; readonly name: string };
}

/**
 * Enrolls `person`, delegates an agent session and joins the desk with their Ledger. Idempotent: a member who
 * already joined (same Ledger, hence same deterministic identity) just gets the desk back.
 */
export async function enrollAndJoinDesk(options: JoinOptions): Promise<Desk> {
  const { ledger, person, company, measurement } = options;
  const onboarding = options.client();
  await onboarding.enroll(
    await signed(ledger, "EmployeeEnroll", {
      company,
      employeeName: toDeviceAscii(person.name),
      team: toDeviceAscii(person.team),
      enclaveMeasurement: measurement,
      employee: person.address,
      issuedAt: toUnixSeconds(new Date()),
      nonce: randomNonce(),
    }),
  );
  const { message, sessionKey } = createAgentSession(person.address, {
    agentName: AGENT_NAME,
    enclaveMeasurement: measurement,
  });
  await onboarding.openSession(await signed(ledger, "AgentSession", message));
  const agent = options.client(sessionKey);
  const identity = deriveDeskIdentity(await ledger.signPersonal(deskIdentityDeriveMessage(company)));
  try {
    return await agent.joinDesk(
      await signed(ledger, "DeskJoin", {
        deskName: options.desk.name,
        company,
        identityCommitment: identity.commitment,
        employee: person.address,
        nonce: randomNonce(),
      }),
    );
  } catch (error) {
    if (!(error instanceof BadgeApiError) || error.code !== "ALREADY_EXISTS") throw error;
    return agent.getDesk(options.desk.id);
  }
}
