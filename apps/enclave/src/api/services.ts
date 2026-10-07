/**
 * Builds the enclave's domain services from injected dependencies. Nothing here reads the environment or opens a
 * connection: tests pass fakes, server.ts passes the real implementations.
 */
import type { NullifierRegistry } from "@badge/zk";
import type { MiddlewareHandler } from "hono";
import { AuditLog, type Sealer } from "../audit";
import type { Clock } from "../clock";
import { ComplianceService } from "../compliance";
import type { Database } from "../db";
import { DeskService, registerDeskFixtures, SqliteNullifierRegistry } from "../desks";
import type { ContextInventory, Directory } from "../directory";
import type { LlmClient } from "../llm/client";
import type { MemoryStore } from "../memory/types";
import { PolicyEngine, type DomainContext, type EnclaveIdentity, type KeyRotator } from "../policy";
import type { BadgeEnv } from "../security/types";
import { createO200kTokenCounter, TaskService, type TokenCounter } from "../tasks";

export interface AppDeps {
  readonly db: Database;
  readonly directory: Directory;
  readonly inventory: ContextInventory;
  readonly memory: MemoryStore;
  readonly llm: LlmClient;
  readonly clock: Clock;
  readonly enclaveIdentity: EnclaveIdentity;
  readonly sealer: Sealer;
  readonly keyRotator: KeyRotator;
  /** Sets `c.get("caller")` or answers 401 (src/security in production, a header-based fake in tests). */
  readonly authenticate: MiddlewareHandler<BadgeEnv>;
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
}

export function createServices(deps: AppDeps): EnclaveServices {
  const ctx: DomainContext = {
    db: deps.db,
    directory: deps.directory,
    audit: new AuditLog(deps.db, deps.clock),
    clock: deps.clock,
    enclave: deps.enclaveIdentity,
  };
  const policy = new PolicyEngine(ctx, deps.keyRotator);
  return {
    ctx,
    policy,
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
      sealer: deps.sealer,
      nullifiers: deps.nullifiers ?? new SqliteNullifierRegistry(deps.db, () => deps.clock.now().getTime()),
    }),
    compliance: new ComplianceService(ctx),
  };
}

/** One-time boot work that needs async crypto: registers the demo desk fixtures. Idempotent. */
export async function prepareEnclaveState(services: EnclaveServices): Promise<void> {
  await registerDeskFixtures(services.desks, services.ctx.directory);
}
