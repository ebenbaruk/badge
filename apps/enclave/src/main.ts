/**
 * Process entry of the enclave service (`pnpm --filter @badge/enclave start`). Configuration comes from the
 * environment (src/config.ts, src/llm/profile.ts, src/memory/honcho-backend.ts); the variable names are in .env.example.
 */
import { startEnclaveServer } from "./server";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

async function main(): Promise<void> {
  const enclave = await startEnclaveServer();
  let stopping = false;
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      console.log(`[enclave] ${signal}: shutting down`);
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
  // Configuration and boot errors are written for operators and never contain secrets (see their loaders).
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[enclave] cannot start: ${name}: ${message}`);
  process.exit(1);
});
