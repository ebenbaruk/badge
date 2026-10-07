/**
 * Builds the enclave's domain services from injected dependencies. Nothing here reads the environment or opens a
 * connection: tests pass fakes, src/main.ts passes the real implementations.
 */
import type { DstackAgent } from "@badge/attest/server";
import type { NullifierRegistry } from "@badge/zk";
import { AuditLog } from "../audit";
import type { Clock } from "../clock";
import { ComplianceService } from "../compliance";
import type { Database } from "../db";
import { DeskService, registerDeskFixtures, SqliteNullifierRegistry } from "../desks";
import type { ContextInventory, Directory } from "../directory";
import type { LlmClient } from "../llm/client";
import type { MemoryStore } from "../memory/types";
import { PolicyEngine, SqliteKeyVersionStore, type DomainContext, type EnclaveMeasurement } from "../policy";
import { KeyRotator } from "../security/keys";
import { createO200kTokenCounter, TaskService, type TokenCounter } from "../tasks";

export interface AppDeps {
  readonly db: Database;
  readonly directory: Directory;
  readonly inventory: ContextInventory;
  readonly memory: MemoryStore;
  readonly llm: LlmClient;
  readonly clock: Clock;
  /**
   * dstack guest agent (the CVM socket in production, the simulator locally): measurement, channel key and quotes,
   * per-employee data keys.
   */
  readonly dstack: DstackAgent;
  /** Production: every /v1 call must come through the attested channel (TLS ends at the Phala gateway). */
  readonly requireChannel: boolean;
  /** Defaults to the o200k_base tokenizer. */
  readonly countTokens?: TokenCounter;
  /** Defaults to the SQLite registry in `db`. */
  readonly nullifiers?: NullifierRegistry;
  /** Receives unexpected errors (the API answers a generic 500). Defaults to logging the error name. */
  readonly onUnexpectedError?: (error: unknown) => void;
}

export interface EnclaveServices {
  readonly ctx: DomainContext;
  readonly policy: PolicyEngine;
  readonly tasks: TaskService;
  readonly desks: DeskService;
  readonly compliance: ComplianceService;
  /** What context each owner holds (GET /v1/me lists the caller's own tags from it). */
  readonly inventory: ContextInventory;
  /** Per-employee data keys, rotated on every revocation. */
  readonly keys: KeyRotator;
}

/** Wires the services; `enclave` is the measurement read from dstack by the security layer. */
export function createServices(deps: AppDeps, enclave: EnclaveMeasurement): EnclaveServices {
  const ctx: DomainContext = {
    db: deps.db,
    directory: deps.directory,
    audit: new AuditLog(deps.db, deps.clock),
    clock: deps.clock,
    enclave,
  };
  const keys = new KeyRotator(deps.dstack, new SqliteKeyVersionStore(deps.db, deps.clock));
  const policy = new PolicyEngine(ctx, keys);
  return {
    ctx,
    policy,
    keys,
    inventory: deps.inventory,
    tasks: new TaskService({
      ctx,
      policy,
      memory: deps.memory,
      llm: deps.llm,
      inventory: deps.inventory,
      countTokens: deps.countTokens ?? createO200kTokenCounter(),
    }),
    desks: new DeskService({
      ctx,
      memory: deps.memory,
      nullifiers: deps.nullifiers ?? new SqliteNullifierRegistry(deps.db, () => deps.clock.now().getTime()),
    }),
    compliance: new ComplianceService(ctx),
  };
}

/** One-time boot work that needs async crypto: registers the demo desk fixtures. Idempotent. */
export async function prepareEnclaveState(services: EnclaveServices): Promise<void> {
  await registerDeskFixtures(services.desks, services.ctx.directory);
}
