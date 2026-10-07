/**
 * Device bridge: one Speculos Flex per employee. The Next server is each employee's "device bridge": it drives the
 * screen for the web mirror (SpeculosDevice) and holds one DMK session per device for signing (LedgerSigner).
 */
import {
  DeviceActionError,
  LedgerConnectionError,
  LedgerSigner,
  SpeculosDevice,
  UserRejectedError,
} from "@badge/ledger";
import type { EmployeeId } from "@/lib/directory";
import { serverConfig } from "./config";

interface DeviceRegistry {
  screens: Map<EmployeeId, SpeculosDevice>;
  signers: Map<EmployeeId, Promise<LedgerSigner>>;
}

// Kept on globalThis so that dev-mode hot reloads reuse the open DMK sessions instead of leaking new ones.
const REGISTRY_KEY = Symbol.for("badge.web.devices");
const globalRegistry = globalThis as typeof globalThis & { [REGISTRY_KEY]?: DeviceRegistry };
const registry: DeviceRegistry = (globalRegistry[REGISTRY_KEY] ??= {
  screens: new Map(),
  signers: new Map(),
});

/** Screen driver of an employee's device (stateless HTTP client, cheap to keep). */
export function deviceScreen(employee: EmployeeId): SpeculosDevice {
  let device = registry.screens.get(employee);
  if (device === undefined) {
    device = new SpeculosDevice(serverConfig().speculosUrls[employee]);
    registry.screens.set(employee, device);
  }
  return device;
}

function connectSigner(employee: EmployeeId): Promise<LedgerSigner> {
  const config = serverConfig();
  const pending = LedgerSigner.connect(config.speculosUrls[employee], {
    calTestKeyPath: config.calTestKeyPath,
  });
  // A failed connection must not stay cached, or every later attempt would replay the same failure.
  pending.catch(() => registry.signers.delete(employee));
  return pending;
}

/** True when the error means the DMK session is unusable (device restarted, transport closed). */
function isSessionLost(error: unknown): boolean {
  if (error instanceof LedgerConnectionError) return true;
  return (
    error instanceof DeviceActionError &&
    !(error instanceof UserRejectedError) &&
    /session|transport|disconnect/i.test(error.message)
  );
}

/**
 * Runs `work` with the employee's signer, opening the DMK session on first use. When the session turns out to be
 * dead, it is dropped so the next call reconnects; the error is still reported to the caller.
 */
export async function withSigner<T>(
  employee: EmployeeId,
  work: (signer: LedgerSigner) => Promise<T>,
): Promise<T> {
  let pending = registry.signers.get(employee);
  if (pending === undefined) {
    pending = connectSigner(employee);
    registry.signers.set(employee, pending);
  }
  const signer = await pending;
  try {
    return await work(signer);
  } catch (error) {
    if (isSessionLost(error) && registry.signers.get(employee) === pending) {
      registry.signers.delete(employee);
      await signer.close().catch((closeError: unknown) => {
        console.warn(`[badge/web] closing the stale ${employee} Ledger session failed`, closeError);
      });
    }
    throw error;
  }
}
