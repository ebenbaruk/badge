/**
 * Single entry point to the enclave for the whole web server (pages, server actions, route handlers).
 */
import { serverConfig } from "../config";
import { MockEnclave } from "../mock/enclave";
import { LiveEnclave } from "./live";
import type { EnclaveApi } from "./types";

export type * from "./types";

// The live client is rebuilt with each module instance (dev hot reloads then run the new code) and keeps its agent
// sessions on globalThis itself; the mock keeps its whole state in the instance, so the instance is what survives.
const MOCK_KEY = Symbol.for("badge.web.mock-enclave");
const globalMock = globalThis as typeof globalThis & { [MOCK_KEY]?: MockEnclave };
let live: LiveEnclave | undefined;

/** The enclave selected by BADGE_ENCLAVE_MODE: the real one by default, the in-memory mock for UI work. */
export function enclave(): EnclaveApi {
  const config = serverConfig();
  if (config.enclaveMode === "live") return (live ??= new LiveEnclave(config.live));
  return (globalMock[MOCK_KEY] ??= new MockEnclave(config.mockMeasurement));
}
