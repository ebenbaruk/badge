/**
 * Checks that the three demo devices answer and prints their Badge addresses (BIP-44 account 0).
 */
import { isAddress } from "viem";
import { describe, expect, it } from "vitest";
import { LedgerSigner } from "../../src/index";
import { DEMO_DEVICES } from "./fixtures";

describe("demo devices", () => {
  it.each(Object.entries(DEMO_DEVICES))("%s answers getAddress", async (name, url) => {
    const signer = await LedgerSigner.connect(url);
    try {
      const address = await signer.getAddress();
      expect(isAddress(address)).toBe(true);
      console.info(`[devices] ${name} ${url} ${address}`);
    } finally {
      await signer.close();
    }
  });
});
