/**
 * Single entry point to the enclave for the whole web server (pages, server actions, route handlers).
 */
import { serverConfig } from "../config";
import { MockEnclave } from "../mock/enclave";
import { createLiveEnclave } from "./live";
import type { EnclaveApi } from "./types";

export type * from "./types";

// globalThis: one mock state per process, kept across dev hot reloads (otherwise every edit resets the demo).
const ENCLAVE_KEY = Symbol.for("badge.web.enclave");
const globalEnclave = globalThis as typeof globalThis & { [ENCLAVE_KEY]?: EnclaveApi };

/** The enclave selected by BADGE_ENCLAVE_MODE (mock by default). */
export function enclave(): EnclaveApi {
  const existing = globalEnclave[ENCLAVE_KEY];
  if (existing !== undefined) return existing;
  const config = serverConfig();
  const created =
    config.enclaveMode === "live" ? createLiveEnclave() : new MockEnclave(config.mockMeasurement);
  globalEnclave[ENCLAVE_KEY] = created;
  return created;
}
