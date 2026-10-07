import { describe, expect, it } from "vitest";
import {
  DEFAULT_DSTACK_SIMULATOR_ENDPOINT,
  DEFAULT_ENCLAVE_PORT,
  EnclaveConfigError,
  loadEnclaveConfig,
} from "./config";

describe("loadEnclaveConfig", () => {
  it("defaults to port 8787 and the local simulator outside a CVM", () => {
    const config = loadEnclaveConfig({ BADGE_DATA_DIR: "/tmp/badge" }, () => false);
    expect(config).toMatchObject({
      port: DEFAULT_ENCLAVE_PORT,
      databasePath: "/tmp/badge/enclave.sqlite",
      dstackEndpoint: DEFAULT_DSTACK_SIMULATOR_ENDPOINT,
      simulated: true,
      requireChannel: true,
    });
  });

  it("allows plain HTTP locally only", () => {
    expect(loadEnclaveConfig({ BADGE_REQUIRE_CHANNEL: "false" }, () => false).requireChannel).toBe(false);
    expect(() => loadEnclaveConfig({ BADGE_REQUIRE_CHANNEL: "false" }, () => true)).toThrow(
      EnclaveConfigError,
    );
  });

  it("never uses the simulator inside a CVM, even if configured", () => {
    const config = loadEnclaveConfig({ DSTACK_SIMULATOR_ENDPOINT: "http://127.0.0.1:9999" }, () => true);
    expect(config.dstackEndpoint).toBeUndefined();
    expect(config.simulated).toBe(false);
  });

  it("rejects an invalid port", () => {
    expect(() => loadEnclaveConfig({ BADGE_ENCLAVE_PORT: "eighty" }, () => false)).toThrow(
      EnclaveConfigError,
    );
  });
});
