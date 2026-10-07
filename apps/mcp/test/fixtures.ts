/**
 * Test doubles: a fake BadgeClient (the part the tools use) and demo-shaped enclave responses (Acme dataset).
 */
import type { AttestationResult, VerifiedAttestation } from "@badge/attest";
import type { ConsentRequest, CreateTaskInput, Measurement, Task } from "@badge/client";
import type { Hex } from "viem";
import type { SessionSummary } from "../src/format";
import type { BadgeAgentApi } from "../src/tools";

export const ALICE = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
export const BOB = "0x58A57ed9d8d624cBD12e2C467D34787555bB1b25";
export const MEASUREMENT: Hex = `0x${"ab".repeat(32)}`;
export const TASK_ID: Hex = `0x${"11".repeat(32)}`;
const CREATED_AT = 1_791_000_000;
const EXPIRES_AT = 1_791_086_400n;

export const SESSION: SessionSummary = {
  employee: ALICE,
  agentName: "Claude Code",
  enclaveMeasurement: MEASUREMENT,
  expiresAt: EXPIRES_AT,
};

export const BRIEF =
  "Durand SA renouvelle son contrat capteurs en novembre ; Bob conseille de parler du delai.";

/** Alice's task waiting for Bob's Ledger. */
export function waitingTask(): Task {
  return {
    id: TASK_ID,
    taskLabel: "Brief Durand",
    status: "waiting_consent",
    allowed: [
      {
        ownerId: "company",
        ownerName: "Acme",
        excerptLabel: "Catalogue capteurs 2026",
        excerptLength: 900,
        via: "company",
      },
    ],
    pending: [
      {
        consentId: "consent-1",
        ownerId: "bob",
        ownerName: "Bob Durand",
        excerptLabel: "Contexte personnel de Bob Durand",
        excerptLength: 420,
        risk: { level: "ok", reasons: [] },
      },
    ],
    blocked: [],
    refused: [],
    brief: null,
    tokenStats: null,
    createdAt: CREATED_AT,
  };
}

/** The same task once Bob signed: brief drafted in the enclave. */
export function readyTask(): Task {
  return {
    ...waitingTask(),
    status: "ready",
    allowed: [
      {
        ownerId: "company",
        ownerName: "Acme",
        excerptLabel: "Catalogue capteurs 2026",
        excerptLength: 900,
        via: "company",
      },
      {
        ownerId: "bob",
        ownerName: "Bob Durand",
        excerptLabel: "Notes rendez-vous Durand",
        excerptLength: 420,
        via: "consent",
      },
    ],
    pending: [],
    brief: BRIEF,
    tokenStats: { selectedTokens: 180, allContextTokens: 5400 },
  };
}

export function contextShareConsent(): ConsentRequest {
  return {
    kind: "ContextShare",
    id: "consent-2",
    status: "pending",
    taskId: TASK_ID,
    requester: { id: "alice", name: "Alice Martin", team: "Ventes" },
    excerpt: {
      label: "Notes rendez-vous Durand",
      length: 420,
      text: "Durand SA renouvelle en novembre.",
      tags: ["clients"],
    },
    message: {
      recipientName: "Alice Martin (Ventes)",
      excerptLabel: "Notes rendez-vous Durand",
      excerptLength: 420,
      taskLabel: "Brief Durand",
      expiresAt: EXPIRES_AT,
      excerptHash: `0x${"cd".repeat(32)}`,
      enclaveMeasurement: MEASUREMENT,
      recipient: ALICE,
      owner: BOB,
      taskId: TASK_ID,
      nonce: 7n,
    },
    risk: {
      level: "warn",
      reasons: [
        {
          code: "OWNER_SHARE_HIGH",
          severity: "warn",
          message: "la tache demande presque tout votre contexte",
        },
      ],
    },
    createdAt: CREATED_AT,
  };
}

export function deskShareConsent(): ConsentRequest {
  return {
    kind: "DeskShare",
    id: `0x${"22".repeat(32)}`,
    status: "pending",
    recipientDesk: "Origination",
    sourceDesk: "Research",
    ruleLabel: "Regle 4 - marche capteurs",
    excerpt: { label: "Prix composants T4", length: 300, text: "Prix composants en hausse au T4." },
    message: {
      recipientDesk: "Origination",
      excerptLabel: "Prix composants T4",
      excerptLength: 300,
      ruleLabel: "Regle 4 - marche capteurs",
      expiresAt: EXPIRES_AT,
      excerptHash: `0x${"ef".repeat(32)}`,
      enclaveMeasurement: MEASUREMENT,
      sourceDesk: "Research",
      requestId: `0x${"22".repeat(32)}`,
      nonce: 8n,
    },
    createdAt: CREATED_AT,
  };
}

export function verifiedAttestation(overrides: Partial<VerifiedAttestation> = {}): VerifiedAttestation {
  return {
    ok: true,
    nonce: "00".repeat(32),
    clientPk: "aa".repeat(32),
    enclavePk: "bb".repeat(32),
    mode: "simulated",
    simulated: true,
    tcbStatus: "Simulated",
    advisoryIds: [],
    composeHash: "ab".repeat(32),
    enclaveMeasurement: MEASUREMENT,
    appId: "ea549f02e1a25fabd1cb788380e033ec5461b2ff",
    rtmr3: "cc".repeat(48),
    keyProvider: "kms",
    warnings: ["simulator quote: DCAP skipped"],
    ...overrides,
  };
}

/** Records every call; each response can be replaced per test. */
export class FakeBadgeApi implements BadgeAgentApi {
  readonly calls: string[] = [];
  readonly createdTasks: CreateTaskInput[] = [];
  createTaskResult: Task | Error = waitingTask();
  getTaskResult: Task | Error = readyTask();
  consents: ConsentRequest[] | Error = [contextShareConsent(), deskShareConsent()];
  attestationResult: AttestationResult | undefined = verifiedAttestation();
  measurementResult: Measurement = {
    measurement: MEASUREMENT,
    composeHash: "ab".repeat(32),
    appId: "ea549f02e1a25fabd1cb788380e033ec5461b2ff",
  };

  get attestation(): AttestationResult | undefined {
    return this.attestationResult;
  }

  async connect(): Promise<VerifiedAttestation> {
    this.calls.push("connect");
    const fresh = verifiedAttestation();
    this.attestationResult = fresh;
    return fresh;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    this.calls.push("createTask");
    this.createdTasks.push(input);
    return settle(this.createTaskResult);
  }

  async getTask(taskId: string): Promise<Task> {
    this.calls.push(`getTask:${taskId}`);
    return settle(this.getTaskResult);
  }

  async listConsents(): Promise<ConsentRequest[]> {
    this.calls.push("listConsents");
    return settle(this.consents);
  }

  async measurement(): Promise<Measurement> {
    this.calls.push("measurement");
    return this.measurementResult;
  }
}

function settle<T>(value: T | Error): T {
  if (value instanceof Error) throw value;
  return value;
}
