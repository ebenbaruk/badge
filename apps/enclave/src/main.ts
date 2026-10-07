/**
 * Process entry point of the enclave (the container image runs this file). It only assembles the security pieces
 * the server expects ({@link SecurityFactory}) from what src/security and @badge/attest already provide, starts the
 * server and stops it cleanly on SIGTERM (docker stop, CVM shutdown).
 */
import { sealToPublicKey } from "@badge/attest";
import type { Address } from "viem";
import { SqliteKeyVersionStore } from "./db";
import { SessionRepository } from "./policy";
import { createAuthMiddleware, KeyRotator as DekKeyRotator, type SessionResolver } from "./security";
import { startEnclaveServer, type SecurityFactory } from "./server";

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

const security: SecurityFactory = ({ db, clock, dstack }) => {
  const sessions = new SessionRepository(db);
  const resolver: SessionResolver = {
    resolve: async (sessionKey: Address) =>
      sessions.findActiveCaller(sessionKey, clock.now().getTime()) ?? null,
  };
  const deks = new DekKeyRotator(dstack, new SqliteKeyVersionStore(db));
  return {
    authenticate: createAuthMiddleware(resolver, { now: () => clock.now().getTime() }),
    keyRotator: {
      rotateOwnerKey: async (employeeId) => {
        await deks.rotate(employeeId);
      },
    },
    sealer: {
      seal: (publicKey, plaintext) => {
        const { v, alg, epk, nonce, ciphertext } = sealToPublicKey(publicKey, plaintext);
        return { v, alg, epk, nonce, ciphertext };
      },
    },
  };
};

async function main(): Promise<void> {
  const enclave = await startEnclaveServer(security);
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      enclave.close().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(
            `[enclave] shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          process.exit(1);
        },
      );
    });
  }
}

main().catch((error: unknown) => {
  // Name and message only: a configuration error names the variable, never its value.
  console.error(
    `[enclave] failed to start: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
  );
  process.exit(1);
});
