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
export const EXCERPT = "Client Dupont: renewal planned for November, budget €120k, café meeting.";
const SALT: Hex = `0x${"11".repeat(32)}`;

export const MESSAGES: BadgeMessages = {
  EmployeeEnroll: {
    company: "Acme",
    employeeName: "Alice Martin",
    team: "Sales",
    enclaveMeasurement: MEASUREMENT,
    employee: alice.address,
    issuedAt: NOW - 60n,
    nonce: 1n,
  },
  AgentSession: {
    agentName: "Claude Code",
    access: "Requests only",
    expiresAt: NOW + 8n * HOUR,
    sessionKey: agentKey.address,
    enclaveMeasurement: MEASUREMENT,
    employee: alice.address,
    nonce: 2n,
  },
  ContextShare: {
    recipientName: "Bob (Sales)",
    excerptLabel: "Dupont client notes",
    excerptLength: excerptLength(EXCERPT),
    taskLabel: "Meeting brief",
    expiresAt: NOW + 24n * HOUR,
    excerptHash: hashExcerpt(EXCERPT),
    enclaveMeasurement: MEASUREMENT,
    recipient: bob.address,
    owner: alice.address,
    taskId: taskIdFrom("Meeting brief", SALT),
    nonce: 3n,
  },
  ContextPolicy: {
    granteeTeam: "Sales",
    contextTag: "clients",
    purpose: "client briefs",
    maxExcerptLength: 500,
    expiresAt: NOW + 30n * 24n * HOUR,
    enclaveMeasurement: MEASUREMENT,
    owner: alice.address,
    nonce: 4n,
  },
  ContextRevoke: {
    targetLabel: "Share with Bob",
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
    recipientDesk: "Research",
    excerptLabel: "Sector note",
    excerptLength: excerptLength(EXCERPT),
    ruleLabel: "Public info",
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
