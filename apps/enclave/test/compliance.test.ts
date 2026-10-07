/**
 * Compliance key registration (no roll-back to a replaced key) and persistence of data-key versions.
 */
import { complianceKeyRegistrationMessage, x25519PublicKey } from "@badge/attest";
import { describe, expect, it } from "vitest";
import { systemClock } from "../src/clock";
import { IN_MEMORY_DATABASE, openDatabase } from "../src/db";
import { SqliteKeyVersionStore } from "../src/policy";
import { call, onboard } from "./flows";
import { complianceKeyPair, createHarness, ledgers, type Harness } from "./harness";

const OTHER_PUBLIC_KEY = Buffer.from(x25519PublicKey(new Uint8Array(32).fill(7))).toString("hex");

async function register(
  h: Harness,
  publicKey: string,
  signer = ledgers.chloe,
  as: "chloe" | "alice" = "chloe",
) {
  const signature = await signer.signMessage({
    message: complianceKeyRegistrationMessage("Acme", publicKey),
  });
  return call(h, "POST", "/v1/compliance/key", { as, body: { publicKey, signature } });
}

describe("compliance key registration", () => {
  it("accepts the officer's key, is idempotent, and never restores a replaced key", async () => {
    const h = await createHarness();
    await onboard(h, "alice", "chloe");
    const { publicKey } = await complianceKeyPair();

    const first = await register(h, publicKey);
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ employeeId: "chloe", publicKey });
    // Same key again (the Ledger re-derives the same one): no new key, same id.
    expect((await register(h, `0x${publicKey.toUpperCase()}`)).json.keyId).toBe(first.json.keyId);

    expect((await register(h, OTHER_PUBLIC_KEY)).status).toBe(201);
    const rollback = await register(h, publicKey);
    expect(rollback.status).toBe(422);
    expect(rollback.json.error.code).toBe("STALE");
  });

  it("refuses a registration signed by another Ledger or sent by a non-officer", async () => {
    const h = await createHarness();
    await onboard(h, "alice", "chloe");
    const { publicKey } = await complianceKeyPair();
    expect((await register(h, publicKey, ledgers.alice)).json.error.code).toBe("SIGNATURE_MISMATCH");
    expect((await register(h, publicKey, ledgers.alice, "alice")).json.error.code).toBe("FORBIDDEN");
  });
});

describe("current compliance key", () => {
  it("is null before the first registration, then the latest key, for the officer only", async () => {
    const h = await createHarness();
    await onboard(h, "alice", "chloe");
    const current = () => call(h, "GET", "/v1/compliance/key", { as: "chloe" });
    expect((await current()).json).toEqual({ key: null });

    const { publicKey } = await complianceKeyPair();
    const registered = await register(h, publicKey);
    expect((await current()).json).toEqual({ key: registered.json });

    await register(h, OTHER_PUBLIC_KEY);
    expect((await current()).json.key.publicKey).toBe(OTHER_PUBLIC_KEY);
    expect((await call(h, "GET", "/v1/compliance/key", { as: "alice" })).json.error.code).toBe("FORBIDDEN");
  });
});

describe("SqliteKeyVersionStore", () => {
  it("starts unset and persists the latest version", () => {
    const store = new SqliteKeyVersionStore(openDatabase(IN_MEMORY_DATABASE), systemClock);
    expect(store.getVersion("bob")).toBeNull();
    store.setVersion("bob", 2);
    store.setVersion("bob", 3);
    expect(store.getVersion("bob")).toBe(3);
    expect(store.getVersion("alice")).toBeNull();
  });
});
