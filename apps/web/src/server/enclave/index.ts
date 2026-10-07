/**
 * Single entry point to the enclave for the whole web server (pages, server actions, route handlers).
 */
import { serverConfig } from "../config";
import { MockEnclave } from "../mock/enclave";
import { LiveEnclave } from "./live";
import type { EnclaveApi } from "./types";

export type * from "./types";

// globalThis: one enclave client (live: agent sessions and channels; mock: its state) per process, kept across dev
// hot reloads, otherwise every edit would drop the employees' agent sessions.
const ENCLAVE_KEY = Symbol.for("badge.web.enclave");
const globalEnclave = globalThis as typeof globalThis & { [ENCLAVE_KEY]?: EnclaveApi };

/** The enclave selected by BADGE_ENCLAVE_MODE: the real one by default, the in-memory mock for UI work. */
export function enclave(): EnclaveApi {
  const existing = globalEnclave[ENCLAVE_KEY];
  if (existing !== undefined) return existing;
  const config = serverConfig();
  const created =
    config.enclaveMode === "live" ? new LiveEnclave(config.live) : new MockEnclave(config.mockMeasurement);
  globalEnclave[ENCLAVE_KEY] = created;
  return created;
}
