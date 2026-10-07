import { privateKeyToAccount } from "viem/accounts";
import type { Hex, TypedDataDefinition } from "viem";
import {
  badgeTypedData,
  hashExcerpt,
  excerptLength,
  taskIdFrom,
  type BadgeMessageKind,
  type BadgeMessages,
} from "../src";

// Well-known Hardhat/Anvil test keys: public, never used for anything real.
export const alice = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
export const bob = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
export const agentKey = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

export const NOW = 1_791_900_000n; // 2026-10-13, a fixed clock keeps the tests deterministic.
export const HOUR = 3600n;
export const MEASUREMENT: Hex = `0x${"ab".repeat(32)}`;
export const EXCERPT = "Client Dupont : renouvellement prévu en novembre, budget 120 k€.";
const SALT: Hex = `0x${"11".repeat(32)}`;

export const MESSAGES: BadgeMessages = {
  EmployeeEnroll: {
    company: "Acme",
    employeeName: "Alice Martin",
    team: "Ventes",
    enclaveMeasurement: MEASUREMENT,
    employee: alice.address,
    issuedAt: NOW - 60n,
    nonce: 1n,
  },
  AgentSession: {
    agentName: "Claude Code",
    access: "Demandes seulement",
    expiresAt: NOW + 8n * HOUR,
    sessionKey: agentKey.address,
    enclaveMeasurement: MEASUREMENT,
    employee: alice.address,
    nonce: 2n,
  },
  ContextShare: {
    recipientName: "Bob (Ventes)",
    excerptLabel: "Notes client Dupont",
    excerptLength: excerptLength(EXCERPT),
    taskLabel: "Brief rendez-vous",
    expiresAt: NOW + 24n * HOUR,
    excerptHash: hashExcerpt(EXCERPT),
    enclaveMeasurement: MEASUREMENT,
    recipient: bob.address,
    owner: alice.address,
    taskId: taskIdFrom("Brief rendez-vous", SALT),
    nonce: 3n,
  },
  ContextPolicy: {
    granteeTeam: "Ventes",
    contextTag: "notes-clients",
    purpose: "Briefs clients",
    maxExcerptLength: 500,
    expiresAt: NOW + 30n * 24n * HOUR,
    enclaveMeasurement: MEASUREMENT,
    owner: alice.address,
    nonce: 4n,
  },
  ContextRevoke: {
    targetLabel: "Partage Bob",
    issuedAt: NOW,
    grantId: `0x${"22".repeat(32)}`,
    recipient: bob.address,
    owner: alice.address,
    nonce: 5n,
  },
  DeskJoin: {
    deskName: "M&A",
    company: "Acme",
    identityCommitment: 123456789n,
    employee: alice.address,
    nonce: 6n,
  },
  DeskShare: {
    recipientDesk: "Recherche",
    excerptLabel: "Note sectorielle",
    excerptLength: excerptLength(EXCERPT),
    ruleLabel: "Info publique",
    expiresAt: NOW + 24n * HOUR,
    excerptHash: hashExcerpt(EXCERPT),
    enclaveMeasurement: MEASUREMENT,
    sourceDesk: "M&A",
    requestId: `0x${"33".repeat(32)}`,
    nonce: 7n,
  },
};

export const KINDS = Object.keys(MESSAGES) as BadgeMessageKind[];

/** Signs like the Ledger would: same EIP-712 payload, signed by a local test key. */
export function signAs<K extends BadgeMessageKind>(
  account: typeof alice,
  kind: K,
  message: BadgeMessages[K],
): Promise<Hex> {
  return account.signTypedData(badgeTypedData(kind, message) as unknown as TypedDataDefinition);
}
