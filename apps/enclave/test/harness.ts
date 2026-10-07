/**
 * In-process enclave for tests: the real app (security layer + domain routes) on an in-memory SQLite, the real
 * directory and notes of the demo dataset (with test Ledger keys instead of the Speculos addresses), a fake dstack
 * agent, and fakes for memory and LLM.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { complianceKeyDeriveMessage, complianceKeyFromSignature } from "@badge/attest";
import type { DstackAgent } from "@badge/attest/server";
import {
  badgeTypedData,
  encodeSignedMessage,
  type BadgeMessageKind,
  type BadgeMessages,
} from "@badge/consent";
import { keccak256, stringToHex, type Hex, type TypedDataDefinition } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { z } from "zod";
import { createEnclaveApp, type EnclaveApp, type EnclaveServices } from "../src/api";
import type { Clock } from "../src/clock";
import { IN_MEMORY_DATABASE, openDatabase } from "../src/db";
import { SqliteNullifierRegistry } from "../src/desks";
import { ContextInventory, Directory, type InventoryNote } from "../src/directory";
import type { ChatMessage, LlmClient } from "../src/llm/client";
import { ACME_DATASET_PATH, loadSeedDataset } from "../src/memory/seed-dataset";
import {
  scopeOf,
  type CandidateExcerpt,
  type FindCandidatesOptions,
  type MemoryStore,
} from "../src/memory/types";

export const MEASUREMENT: Hex = `0x${"5a".repeat(32)}`;
export const OTHER_MEASUREMENT: Hex = `0x${"66".repeat(32)}`;
/** 2026-10-08 08:00 UTC: a fixed clock keeps expiries deterministic. */
export const START = new Date("2026-10-08T08:00:00Z");

function testKey(name: string): PrivateKeyAccount {
  return privateKeyToAccount(keccak256(stringToHex(`badge-enclave-test:${name}`)));
}

/** Stand-ins for the employees' Ledgers and for their agents' session keys. */
export const ledgers = {
  alice: testKey("ledger:alice"),
  bob: testKey("ledger:bob"),
  chloe: testKey("ledger:chloe"),
};
export const agents = {
  alice: testKey("agent:alice"),
  bob: testKey("agent:bob"),
  chloe: testKey("agent:chloe"),
};
export type DemoEmployee = keyof typeof ledgers;

export class TestClock implements Clock {
  constructor(private current: Date = START) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Memory fake: a note is a candidate when one of its tags appears in the task text (ranked in dataset order). */
export class FakeMemory implements MemoryStore {
  constructor(private readonly notes: readonly InventoryNote[]) {}

  async ingest(): Promise<never> {
    throw new Error("FakeMemory.ingest is not used by the enclave routes");
  }

  async findCandidates(task: string, options: FindCandidatesOptions): Promise<CandidateExcerpt[]> {
    const text = task.toLowerCase();
    return this.notes
      .filter((note) => note.tags.some((tag) => text.includes(tag.toLowerCase())))
      .map((note, index) => ({
        ownerId: note.ownerId,
        scope: scopeOf(note.ownerId),
        text: note.text,
        source: { kind: "note" as const, id: note.id },
        tags: note.tags,
        score: 0.9 - index * 0.01,
        ownedByRequester: note.ownerId === options.requesterId,
      }));
  }
}

/** LLM fake: everything is relevant except notes marked confidential; the brief cites what it was given. */
export class FakeLlm implements LlmClient {
  readonly briefInputs: string[] = [];

  async complete(messages: readonly ChatMessage[]): Promise<string> {
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    this.briefInputs.push(user);
    return "Brief Orion\n- point [1]";
  }

  async structuredCompletion<T>(schema: z.ZodType<T>, messages: readonly ChatMessage[]): Promise<T> {
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    const confidential = user.includes("Confidentiel RH");
    return schema.parse({
      relevant: !confidential,
      relevance: confidential ? 0.1 : 0.8,
      containsPersonalData: confidential,
      reason: "test",
    });
  }

  async embed(): Promise<number[][]> {
    throw new Error("FakeLlm.embed is not used by the enclave routes");
  }
}

/**
 * dstack agent fake: a fixed compose hash (so the measurement is {@link MEASUREMENT}) and deterministic keys. No
 * quotes: in-process tests use the plain transport (the attested channel has its own simulator test).
 */
export class FakeDstack implements DstackAgent {
  constructor(private readonly composeHash: string) {}

  async info() {
    return { app_id: "badge-test", compose_hash: this.composeHash, tcb_info: { app_compose: "{}" } };
  }

  async getKey(path: string) {
    return { key: new Uint8Array(createHash("sha256").update(`test-kms:${path}`).digest()) };
  }

  async getQuote(): Promise<never> {
    throw new Error("FakeDstack has no quotes: use the dstack simulator for channel tests");
  }
}

/** The demo directory with test Ledger addresses. */
export function testDirectory(): Directory {
  const raw = JSON.parse(readFileSync(ACME_DATASET_PATH, "utf8")) as {
    employees: Array<{ id: string; ledgerAddress: string | null }>;
  };
  for (const employee of raw.employees) {
    employee.ledgerAddress = ledgers[employee.id as DemoEmployee].address;
  }
  return Directory.fromSeed(raw);
}

export function seedNotes(): InventoryNote[] {
  return loadSeedDataset().notes;
}

export interface Harness extends EnclaveApp {
  readonly clock: TestClock;
  readonly llm: FakeLlm;
  readonly nullifiers: SqliteNullifierRegistry;
  readonly notes: InventoryNote[];
  readonly services: EnclaveServices;
}

export async function createHarness(
  options: { notes?: InventoryNote[]; measurement?: Hex } = {},
): Promise<Harness> {
  const db = openDatabase(IN_MEMORY_DATABASE);
  const clock = new TestClock();
  const notes = options.notes ?? seedNotes();
  const llm = new FakeLlm();
  const nullifiers = new SqliteNullifierRegistry(db, () => clock.now().getTime());
  const enclave = await createEnclaveApp({
    db,
    directory: testDirectory(),
    inventory: new ContextInventory(notes),
    memory: new FakeMemory(notes),
    llm,
    clock,
    dstack: new FakeDstack((options.measurement ?? MEASUREMENT).slice(2)),
    requireChannel: false,
    countTokens: (text: string) => Math.ceil(text.length / 4),
    nullifiers,
  });
  return { ...enclave, clock, llm, nullifiers, notes };
}

/** Chloe's compliance key pair, derived from her (test) Ledger exactly like the real one. */
export async function complianceKeyPair(): Promise<{ secretKey: Uint8Array; publicKey: string }> {
  const signature = await ledgers.chloe.signMessage({ message: complianceKeyDeriveMessage("Acme") });
  const { secretKey, publicKey } = complianceKeyFromSignature(signature);
  return { secretKey, publicKey: Buffer.from(publicKey).toString("hex") };
}

/** Signs a Badge message like the Ledger would and returns its JSON wire form. */
export async function signedWire<K extends BadgeMessageKind>(
  account: PrivateKeyAccount,
  kind: K,
  message: BadgeMessages[K],
): Promise<unknown> {
  const signature = await signTyped(account, kind, message);
  return encodeSignedMessage({ kind, message, signature });
}

export function signTyped<K extends BadgeMessageKind>(
  account: PrivateKeyAccount,
  kind: K,
  message: BadgeMessages[K],
): Promise<Hex> {
  return account.signTypedData(badgeTypedData(kind, message) as unknown as TypedDataDefinition);
}

let nonceCounter = 1n;
/** A fresh nonce per call. */
export function nextNonce(): bigint {
  return nonceCounter++;
}
