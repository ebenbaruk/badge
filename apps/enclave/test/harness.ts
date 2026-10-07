/**
 * In-process enclave for tests: in-memory SQLite, the real directory and notes of the demo dataset (with test
 * Ledger keys instead of the Speculos addresses), and fakes for memory, LLM, sealing and key rotation.
 */
import { readFileSync } from "node:fs";
import {
  badgeTypedData,
  encodeSignedMessage,
  type BadgeMessageKind,
  type BadgeMessages,
} from "@badge/consent";
import type { MiddlewareHandler } from "hono";
import { isAddress, keccak256, stringToHex, type Hex, type TypedDataDefinition } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { z } from "zod";
import { createApp, createServices, prepareEnclaveState, type EnclaveServices } from "../src/api";
import type { SealedBlob, Sealer } from "../src/audit";
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
import type { KeyRotator } from "../src/policy";
import { SessionRepository } from "../src/policy/repository";
import type { BadgeEnv } from "../src/security/types";

export const MEASUREMENT: Hex = `0x${"5a".repeat(32)}`;
export const OTHER_MEASUREMENT: Hex = `0x${"66".repeat(32)}`;
/** 2026-10-08 08:00 UTC: a fixed clock keeps expiries deterministic. */
export const START = new Date("2026-10-08T08:00:00Z");
export const SESSION_HEADER = "x-test-session";

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

/** Sealer fake: "seals" by hex-encoding, so tests can check what the compliance officer would read. */
export class FakeSealer implements Sealer {
  readonly calls: Array<{ publicKey: Uint8Array; plaintext: string }> = [];

  seal(publicKey: Uint8Array, plaintext: Uint8Array): SealedBlob {
    const text = new TextDecoder().decode(plaintext);
    this.calls.push({ publicKey, plaintext: text });
    return { alg: "test-x25519", ciphertext: Buffer.from(text).toString("hex") };
  }
}

export class FakeKeyRotator implements KeyRotator {
  readonly rotated: string[] = [];
  async rotateOwnerKey(employeeId: string): Promise<void> {
    this.rotated.push(employeeId);
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

/** Test-only authentication: the session key in a header, looked up like the real middleware does. */
export function headerAuth(sessions: SessionRepository, clock: Clock): MiddlewareHandler<BadgeEnv> {
  return async (c, next) => {
    const key = c.req.header(SESSION_HEADER);
    const caller = key && isAddress(key) ? sessions.findActiveCaller(key, clock.now().getTime()) : undefined;
    if (!caller) return c.json({ error: { code: "UNAUTHENTICATED", message: "no valid session" } }, 401);
    c.set("caller", caller);
    await next();
  };
}

export interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly services: EnclaveServices;
  readonly clock: TestClock;
  readonly llm: FakeLlm;
  readonly sealer: FakeSealer;
  readonly keyRotator: FakeKeyRotator;
  readonly nullifiers: SqliteNullifierRegistry;
  readonly notes: InventoryNote[];
}

export async function createHarness(
  options: { notes?: InventoryNote[]; measurement?: Hex } = {},
): Promise<Harness> {
  const db = openDatabase(IN_MEMORY_DATABASE);
  const clock = new TestClock();
  const notes = options.notes ?? seedNotes();
  const llm = new FakeLlm();
  const sealer = new FakeSealer();
  const keyRotator = new FakeKeyRotator();
  const nullifiers = new SqliteNullifierRegistry(db, () => clock.now().getTime());
  const deps = {
    db,
    directory: testDirectory(),
    inventory: new ContextInventory(notes),
    memory: new FakeMemory(notes),
    llm,
    clock,
    enclaveIdentity: { measurement: options.measurement ?? MEASUREMENT },
    sealer,
    keyRotator,
    authenticate: headerAuth(new SessionRepository(db), clock),
    countTokens: (text: string) => Math.ceil(text.length / 4),
    nullifiers,
  };
  const services = createServices(deps);
  await prepareEnclaveState(services);
  return { app: createApp(deps, services), services, clock, llm, sealer, keyRotator, nullifiers, notes };
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
