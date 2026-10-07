/**
 * Wires the real dependencies (SQLite file, Honcho memory, LLM profile, dstack) and serves the API on Node with
 * @hono/node-server. Nothing secret is logged: the LLM key and the Honcho JWT stay inside their loaders.
 */
import { createDstackClient } from "@badge/attest/server";
import { serve, type ServerType } from "@hono/node-server";
import type { Hex } from "viem";
import { createEnclaveApp, type AppDeps } from "./api";
import { systemClock } from "./clock";
import { loadEnclaveConfig, type EnclaveConfig } from "./config";
import { openDatabase } from "./db";
import { ContextInventory, loadDirectory } from "./directory";
import { createLlmClient, describeLlmProfile, loadLlmProfile } from "./llm";
import { HonchoBackend, HonchoMemory, loadHonchoConfig, loadSeedDataset } from "./memory";

/** Builds every real dependency from the configuration and the environment (LLM profile, Honcho). */
export function buildAppDeps(config: EnclaveConfig, env: NodeJS.ProcessEnv = process.env): AppDeps {
  const profile = loadLlmProfile(env);
  const llm = createLlmClient(profile);
  console.log(`[enclave] LLM profile ${describeLlmProfile(profile)}`);
  return {
    db: openDatabase(config.databasePath),
    directory: loadDirectory(config.seedFile),
    inventory: new ContextInventory(loadSeedDataset(config.seedFile).notes),
    memory: new HonchoMemory(new HonchoBackend(loadHonchoConfig(env)), llm),
    llm,
    clock: systemClock,
    dstack: createDstackClient(config.dstackEndpoint),
    requireChannel: config.requireChannel,
  };
}

export interface RunningEnclave {
  readonly server: ServerType;
  readonly measurement: Hex;
  readonly config: EnclaveConfig;
  close(): Promise<void>;
}

/**
 * Starts the enclave API (127.0.0.1:8787 by default).
 * @throws EnclaveConfigError / LlmConfigError / MemoryConfigError on a bad environment, SecurityError
 * ("dstack_failed") when the dstack agent (or the local simulator) cannot be reached.
 */
export async function startEnclaveServer(env: NodeJS.ProcessEnv = process.env): Promise<RunningEnclave> {
  const config = loadEnclaveConfig(env);
  const deps = buildAppDeps(config, env);
  let enclave: Awaited<ReturnType<typeof createEnclaveApp>>;
  try {
    enclave = await createEnclaveApp(deps);
  } catch (error) {
    deps.db.close();
    throw error;
  }
  const server = await new Promise<ServerType>((resolve) => {
    const started = serve({ fetch: enclave.app.fetch, port: config.port, hostname: config.host }, () =>
      resolve(started),
    );
  });
  console.log(
    `[enclave] listening on http://${config.host}:${config.port} | measurement ${enclave.measurement} | ` +
      `${config.simulated ? "SIMULATED TEE (dstack simulator)" : "TDX CVM"} | ` +
      `${config.requireChannel ? "attested channel required" : "plain HTTP allowed (local only)"} | ` +
      `data ${config.databasePath}`,
  );
  return {
    server,
    measurement: enclave.measurement,
    config,
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
