import { enclaveMeasurementFrom } from "@badge/attest";
import type { DstackAgent } from "@badge/attest/server";
import type { Measurement } from "@badge/client";
import { SecurityError } from "./errors";

/**
 * Reads the enclave identity once from the dstack guest agent: the compose hash (what the deployment runs) and its
 * bytes32 form, the `enclaveMeasurement` every signed Badge message must carry. Cached: it cannot change while the
 * CVM runs. A failed read is not cached, so a transient agent failure does not stick.
 */
export class EnclaveIdentity {
  private cached: Promise<Measurement> | undefined;

  constructor(private readonly dstack: DstackAgent) {}

  /** @throws SecurityError("dstack_failed") when the guest agent cannot be reached or answers nonsense. */
  read(): Promise<Measurement> {
    this.cached ??= this.load().catch((error: unknown) => {
      this.cached = undefined;
      throw error;
    });
    return this.cached;
  }

  private async load(): Promise<Measurement> {
    let info: Awaited<ReturnType<DstackAgent["info"]>>;
    try {
      info = await this.dstack.info();
    } catch (error) {
      throw new SecurityError("dstack_failed", 503, "cannot read the enclave identity from dstack", {
        cause: error,
      });
    }
    const composeHash = info.compose_hash.replace(/^0x/, "").toLowerCase();
    let measurement: `0x${string}`;
    try {
      measurement = enclaveMeasurementFrom(composeHash);
    } catch (error) {
      throw new SecurityError("dstack_failed", 503, "dstack returned a malformed compose hash", {
        cause: error,
      });
    }
    return { measurement, composeHash, appId: info.app_id };
  }
}
