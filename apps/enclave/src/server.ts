/**
 * Wires the real dependencies (SQLite file, Honcho memory, LLM profile, dstack measurement) and serves the API on
 * Node with @hono/node-server. The security pieces (request authentication, data-key rotation, sealing to the
 * compliance key) come from src/security and @badge/attest through {@link SecurityFactory}, so this file never
 * decides how a request is authenticated.
 */
import { createDstackClient, type DstackAgent } from "@badge/attest/server";
import { enclaveMeasurementFrom } from "@badge/attest";
import { serve, type ServerType } from "@hono/node-server";
import type { MiddlewareHandler } from "hono";
import { createApp, createServices, prepareEnclaveState, type AppDeps } from "./api";
import type { Sealer } from "./audit";
import { systemClock, type Clock } from "./clock";
import { loadEnclaveConfig, type EnclaveConfig } from "./config";
import { openDatabase, type Database } from "./db";
import { ContextInventory, loadDirectory } from "./directory";
import { createLlmClient, loadLlmProfile } from "./llm";
import { HonchoBackend, HonchoMemory, loadHonchoConfig, loadSeedDataset } from "./memory";
import type { EnclaveIdentity, KeyRotator } from "./policy";
import type { BadgeEnv } from "./security/types";

/** What the security layer receives to build its pieces (sessions are looked up in `db`). */
export interface SecurityContext {
  readonly db: Database;
  readonly clock: Clock;
  readonly dstack: DstackAgent;
  readonly config: EnclaveConfig;
}

export interface SecurityDeps {
  readonly authenticate: MiddlewareHandler<BadgeEnv>;
  readonly keyRotator: KeyRotator;
  readonly sealer: Sealer;
}

export type SecurityFactory = (context: SecurityContext) => SecurityDeps | Promise<SecurityDeps>;

/**
 * The enclave measurement = the deployment's compose hash as bytes32, read from the dstack guest agent (the
 * simulator locally). Every signed message must carry it.
 */
export async function readEnclaveIdentity(dstack: DstackAgent): Promise<EnclaveIdentity> {
  const info = await dstack.info();
  return { measurement: enclaveMeasurementFrom(info.compose_hash) };
}

/** Builds every real dependency from the configuration. */
export async function buildAppDeps(config: EnclaveConfig, security: SecurityFactory): Promise<AppDeps> {
  const clock = systemClock;
  const dstack = createDstackClient(config.dstackEndpoint);
  const db = openDatabase(config.databasePath);
  const llm = createLlmClient(loadLlmProfile());
  const { authenticate, keyRotator, sealer } = await security({ db, clock, dstack, config });
  return {
    db,
    directory: loadDirectory(config.seedFile),
    inventory: new ContextInventory(loadSeedDataset(config.seedFile).notes),
    memory: new HonchoMemory(new HonchoBackend(loadHonchoConfig()), llm),
    llm,
    clock,
    enclaveIdentity: await readEnclaveIdentity(dstack),
    sealer,
    keyRotator,
    authenticate,
  };
}

export interface RunningEnclave {
  readonly server: ServerType;
  readonly measurement: `0x${string}`;
  close(): Promise<void>;
}

/** Starts the enclave API (port 8787 by default). */
export async function startEnclaveServer(
  security: SecurityFactory,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunningEnclave> {
  const config = loadEnclaveConfig(env);
  const deps = await buildAppDeps(config, security);
  const services = createServices(deps);
  await prepareEnclaveState(services);
  const app = createApp(deps, services);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host });
  console.log(
    `[enclave] listening on ${config.host}:${config.port}, measurement ${deps.enclaveIdentity.measurement}${config.simulated ? " (simulated TEE)" : ""}`,
  );
  return {
    server,
    measurement: deps.enclaveIdentity.measurement,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          deps.db.close();
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
