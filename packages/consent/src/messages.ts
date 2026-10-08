/**
 * Badge EIP-712 messages: the single source of truth shared by the device, the web app and the enclave.
 *
 * Two Ledger display constraints shape these definitions (verified on Speculos Flex):
 * - The device shows fields in **struct order**, not descriptor order, so each struct lists the displayed fields
 *   first, in reading order, followed by the hidden technical fields.
 * - The device only renders ASCII, so every displayed string must go through `toDeviceAscii` before signing.
 */
import type { Address, Hex } from "viem";
import { toDeviceAscii } from "./ascii";

/** Off-chain messages still need a chainId and a verifyingContract for clear signing (ERC-7730). */
export const BADGE_DOMAIN = {
  name: "Badge",
  version: "1",
  chainId: 1,
  verifyingContract: "0x000000000000000000000000000000000000bad9",
} as const satisfies {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

export const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

export const BADGE_TYPES = {
  /** An employee joins Badge and binds their Ledger address to their directory identity. */
  EmployeeEnroll: [
    { name: "company", type: "string" },
    { name: "employeeName", type: "string" },
    { name: "team", type: "string" },
    { name: "enclaveMeasurement", type: "bytes32" },
    { name: "employee", type: "address" },
    { name: "issuedAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
  /** Delegates request rights (never read rights on others' context) to the agent's session key. */
  AgentSession: [
    { name: "agentName", type: "string" },
    { name: "access", type: "string" },
    { name: "expiresAt", type: "uint64" },
    { name: "sessionKey", type: "address" },
    { name: "enclaveMeasurement", type: "bytes32" },
    { name: "employee", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
  /** One-off consent: this exact excerpt (by hash) may leave the owner's scope, to this recipient, until expiry. */
  ContextShare: [
    { name: "recipientName", type: "string" },
    { name: "excerptLabel", type: "string" },
    { name: "excerptLength", type: "uint32" },
    { name: "taskLabel", type: "string" },
    { name: "expiresAt", type: "uint64" },
    { name: "excerptHash", type: "bytes32" },
    { name: "enclaveMeasurement", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "owner", type: "address" },
    { name: "taskId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
  /** Standing agreement: a team may use a tagged part of the owner's context for a purpose, bounded and logged. */
  ContextPolicy: [
    { name: "granteeTeam", type: "string" },
    { name: "contextTag", type: "string" },
    { name: "purpose", type: "string" },
    { name: "maxExcerptLength", type: "uint32" },
    { name: "expiresAt", type: "uint64" },
    { name: "enclaveMeasurement", type: "bytes32" },
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
  /** Revokes a grant (share or policy) or, with grantId = 0x0, everything granted to `recipient`. */
  ContextRevoke: [
    { name: "targetLabel", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "grantId", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
  /** Registers the employee's anonymous Semaphore identity commitment in a desk group. */
  DeskJoin: [
    { name: "deskName", type: "string" },
    { name: "company", type: "string" },
    { name: "identityCommitment", type: "uint256" },
    { name: "employee", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
  /**
   * Desk-to-desk share across a "Chinese wall": the recipient desk learns the excerpt and a ZK proof of desk
   * membership, never the signer. The signature itself stays in the enclave for compliance.
   */
  DeskShare: [
    { name: "recipientDesk", type: "string" },
    { name: "excerptLabel", type: "string" },
    { name: "excerptLength", type: "uint32" },
    { name: "ruleLabel", type: "string" },
    { name: "expiresAt", type: "uint64" },
    { name: "excerptHash", type: "bytes32" },
    { name: "enclaveMeasurement", type: "bytes32" },
    { name: "sourceDesk", type: "string" },
    { name: "requestId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export type BadgeMessageKind = keyof typeof BADGE_TYPES;

export interface EmployeeEnroll {
  company: string;
  employeeName: string;
  team: string;
  enclaveMeasurement: Hex;
  employee: Address;
  issuedAt: bigint;
  nonce: bigint;
}

export interface AgentSession {
  agentName: string;
  access: string;
  expiresAt: bigint;
  sessionKey: Address;
  enclaveMeasurement: Hex;
  employee: Address;
  nonce: bigint;
}

export interface ContextShare {
  recipientName: string;
  excerptLabel: string;
  excerptLength: number;
  taskLabel: string;
  expiresAt: bigint;
  excerptHash: Hex;
  enclaveMeasurement: Hex;
  recipient: Address;
  owner: Address;
  taskId: Hex;
  nonce: bigint;
}

export interface ContextPolicy {
  granteeTeam: string;
  contextTag: string;
  purpose: string;
  maxExcerptLength: number;
  expiresAt: bigint;
  enclaveMeasurement: Hex;
  owner: Address;
  nonce: bigint;
}

export interface ContextRevoke {
  targetLabel: string;
  issuedAt: bigint;
  grantId: Hex;
  recipient: Address;
  owner: Address;
  nonce: bigint;
}

export interface DeskJoin {
  deskName: string;
  company: string;
  identityCommitment: bigint;
  employee: Address;
  nonce: bigint;
}

export interface DeskShare {
  recipientDesk: string;
  excerptLabel: string;
  excerptLength: number;
  ruleLabel: string;
  expiresAt: bigint;
  excerptHash: Hex;
  enclaveMeasurement: Hex;
  sourceDesk: string;
  requestId: Hex;
  nonce: bigint;
}

export interface BadgeMessages {
  EmployeeEnroll: EmployeeEnroll;
  AgentSession: AgentSession;
  ContextShare: ContextShare;
  ContextPolicy: ContextPolicy;
  ContextRevoke: ContextRevoke;
  DeskJoin: DeskJoin;
  DeskShare: DeskShare;
}

/** Field formats supported by the device's EIP-712 filters (v2) that we use. */
export type FieldFormat = "raw" | "datetime";

/** Minimal ERC-7730 subset: what the device shows, in which order, under which ASCII label. */
export interface ClearSignDescriptor {
  /** Shown by the device under "Contract"; keep it short and ASCII. */
  intent: string;
  fields: ReadonlyArray<{ path: string; label: string; format: FieldFormat }>;
}

/**
 * Display descriptors (English labels, ASCII only). Fields not listed are signed but not displayed.
 * The enclave measurement is shown in full on purpose: it is what pins the consent to the attested enclave.
 */
export const BADGE_DESCRIPTORS: { [K in BadgeMessageKind]: ClearSignDescriptor } = {
  EmployeeEnroll: {
    intent: "Join Badge",
    fields: [
      { path: "company", label: "Company", format: "raw" },
      { path: "employeeName", label: "Identity", format: "raw" },
      { path: "team", label: "Team", format: "raw" },
      { path: "enclaveMeasurement", label: "Enclave", format: "raw" },
    ],
  },
  AgentSession: {
    intent: "Authorize my agent",
    fields: [
      { path: "agentName", label: "Agent", format: "raw" },
      { path: "access", label: "Access", format: "raw" },
      { path: "expiresAt", label: "Expires", format: "datetime" },
      { path: "sessionKey", label: "Agent key", format: "raw" },
    ],
  },
  ContextShare: {
    intent: "Share an excerpt",
    fields: [
      { path: "recipientName", label: "Share with", format: "raw" },
      { path: "excerptLabel", label: "Excerpt", format: "raw" },
      { path: "excerptLength", label: "Length (chars)", format: "raw" },
      { path: "taskLabel", label: "Task", format: "raw" },
      { path: "expiresAt", label: "Expires", format: "datetime" },
      { path: "excerptHash", label: "Fingerprint", format: "raw" },
      { path: "enclaveMeasurement", label: "Enclave", format: "raw" },
    ],
  },
  ContextPolicy: {
    intent: "Standing agreement",
    fields: [
      { path: "granteeTeam", label: "Allowed team", format: "raw" },
      { path: "contextTag", label: "Context", format: "raw" },
      { path: "purpose", label: "Purpose", format: "raw" },
      { path: "maxExcerptLength", label: "Max per excerpt", format: "raw" },
      { path: "expiresAt", label: "Expires", format: "datetime" },
      { path: "enclaveMeasurement", label: "Enclave", format: "raw" },
    ],
  },
  ContextRevoke: {
    intent: "Revoke access",
    fields: [
      { path: "targetLabel", label: "Revoke", format: "raw" },
      { path: "issuedAt", label: "On", format: "datetime" },
    ],
  },
  DeskJoin: {
    intent: "Join a desk",
    fields: [
      { path: "deskName", label: "Desk", format: "raw" },
      { path: "company", label: "Company", format: "raw" },
      { path: "identityCommitment", label: "Anonymous identity", format: "raw" },
    ],
  },
  DeskShare: {
    intent: "Anonymous share",
    fields: [
      { path: "recipientDesk", label: "To desk", format: "raw" },
      { path: "excerptLabel", label: "Excerpt", format: "raw" },
      { path: "excerptLength", label: "Length (chars)", format: "raw" },
      { path: "ruleLabel", label: "Rule", format: "raw" },
      { path: "expiresAt", label: "Expires", format: "datetime" },
      { path: "excerptHash", label: "Fingerprint", format: "raw" },
      { path: "enclaveMeasurement", label: "Enclave", format: "raw" },
    ],
  },
};

/**
 * EIP-191 message from which the anonymous desk identity is derived (secret = keccak256(signature)).
 * EIP-191 rather than EIP-712: it is shown in clear without any descriptor or blind-signing warning, and Ledger
 * signatures are deterministic (RFC 6979), so the same Ledger always re-derives the same identity.
 * The company name is folded to device ASCII: the Ethereum app shows a non-ASCII personal message as raw hex, which
 * would make the owner sign something unreadable.
 */
export function deskIdentityDeriveMessage(company: string): string {
  return [
    "Badge - anonymous desk identity",
    `Company: ${toDeviceAscii(company)}`,
    "Only sign this message in Badge.",
  ].join("\n");
}
