/**
 * Sample Badge messages for the live tests, and what the device must display for them.
 */
import { BADGE_DESCRIPTORS, BADGE_TYPES, type BadgeMessageKind, type BadgeMessages } from "@badge/consent";
import { keccak256, toHex, type Address, type Hex } from "viem";

export const SPECULOS_URL = process.env.BADGE_SPECULOS_URL ?? "http://localhost:5001";
export const DEMO_DEVICES = {
  alice: "http://localhost:5001",
  bob: "http://localhost:5002",
  chloe: "http://localhost:5003",
} as const;

const RECIPIENT: Address = "0x6370eF2f4Db3611D657b90667De398a2Cc2a370C";
const MEASUREMENT: Hex = keccak256(toHex("badge-enclave-measurement"));
/** 2026-10-04T08:00:00Z */
const EXPIRES_AT = 1_791_100_800n;

export function sampleMessages(signer: Address): BadgeMessages {
  return {
    EmployeeEnroll: {
      company: "Acme",
      employeeName: "Alice Martin",
      team: "Ventes",
      enclaveMeasurement: MEASUREMENT,
      employee: signer,
      issuedAt: EXPIRES_AT,
      nonce: 1n,
    },
    AgentSession: {
      agentName: "Claude Code",
      access: "demandes uniquement",
      expiresAt: EXPIRES_AT,
      sessionKey: RECIPIENT,
      enclaveMeasurement: MEASUREMENT,
      employee: signer,
      nonce: 2n,
    },
    ContextShare: {
      recipientName: "Alice (Ventes)",
      excerptLabel: "conditions Orion 2025",
      excerptLength: 87,
      taskLabel: "brief Orion",
      expiresAt: EXPIRES_AT,
      excerptHash: keccak256(toHex("Conditions Orion 2025")),
      enclaveMeasurement: MEASUREMENT,
      recipient: RECIPIENT,
      owner: signer,
      taskId: keccak256(toHex("task:brief-orion")),
      nonce: 3n,
    },
    ContextPolicy: {
      granteeTeam: "Ventes",
      contextTag: "notes clients",
      purpose: "briefs",
      maxExcerptLength: 500,
      expiresAt: EXPIRES_AT,
      enclaveMeasurement: MEASUREMENT,
      owner: signer,
      nonce: 4n,
    },
    ContextRevoke: {
      targetLabel: "Alice (Ventes) - brief Orion",
      issuedAt: EXPIRES_AT,
      grantId: keccak256(toHex("grant")),
      recipient: RECIPIENT,
      owner: signer,
      nonce: 5n,
    },
    DeskJoin: {
      deskName: "Fusions",
      company: "Acme",
      identityCommitment: 1234567890123456789n,
      employee: signer,
      nonce: 6n,
    },
    DeskShare: {
      recipientDesk: "Recherche",
      excerptLabel: "calendrier Orion",
      excerptLength: 42,
      ruleLabel: "mur de Chine OK",
      expiresAt: EXPIRES_AT,
      excerptHash: keccak256(toHex("calendrier")),
      enclaveMeasurement: MEASUREMENT,
      sourceDesk: "Fusions",
      requestId: keccak256(toHex("request")),
      nonce: 7n,
    },
  };
}

/** Collapses the page texts so that values wrapped over several lines can be searched. */
export function flatten(pages: ReadonlyArray<{ texts: string[] }>): { spaced: string; compact: string } {
  const spaced = pages
    .flatMap((page) => page.texts)
    .join(" ")
    .replace(/\s+/g, " ");
  return { spaced, compact: spaced.replace(/\s/g, "").toLowerCase() };
}

/** The device's datetime rendering: `YYYY-MM-DD` then `HH:MM:SS AM UTC`, on separate lines. */
function datetimeParts(seconds: bigint): string[] {
  const iso = new Date(Number(seconds) * 1000).toISOString();
  return [iso.slice(0, 10), iso.slice(11, 19)];
}

/**
 * Strings the review must contain for `kind`: the intent, every label, and every displayed value. Non-string values
 * are matched without spaces and case-insensitively (the device wraps them anywhere and may upper-case hex).
 */
export function expectedDisplay<K extends BadgeMessageKind>(
  kind: K,
  message: BadgeMessages[K],
): { spaced: string[]; compact: string[] } {
  const descriptor = BADGE_DESCRIPTORS[kind];
  const spaced = [descriptor.intent];
  const compact: string[] = [];
  const values = message as unknown as Record<string, unknown>;
  for (const field of descriptor.fields) {
    spaced.push(field.label);
    const value = values[field.path];
    const type = BADGE_TYPES[kind].find((f) => f.name === field.path)?.type;
    if (field.format === "datetime" && typeof value === "bigint") {
      spaced.push(...datetimeParts(value));
    } else if (type === "string") {
      spaced.push(String(value));
    } else {
      // Hex and long numbers are wrapped by the device without spaces.
      compact.push(String(value).toLowerCase());
    }
  }
  return { spaced, compact };
}
