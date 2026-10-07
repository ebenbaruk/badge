/**
 * Per-employee data-encryption keys (DEKs), derived from the dstack KMS rather than stored: the same deployment
 * re-derives them after a restart, and no other app (or a modified build) can. Rotation bumps a version counter;
 * the key for (employee, version) is getKey(`badge/dek/{employeeId}:{version}`), so a rotated key is unrelated to
 * the previous one and revoking access (e.g. after a ContextRevoke) cannot be undone by anyone holding the old key.
 */
import { deriveEnclaveKey, ENCLAVE_KEY_PATHS, type DstackAgent } from "@badge/attest/server";

/** Persists the current key version of each employee (implemented by the domain's storage). */
export interface KeyVersionStore {
  /** Current version, or null when the employee never rotated (version {@link INITIAL_KEY_VERSION}). */
  getVersion(employeeId: string): number | null | Promise<number | null>;
  setVersion(employeeId: string, version: number): void | Promise<void>;
}

/** What data-access code needs: the key to encrypt with now, and the key of any version to decrypt old data. */
export interface DekProvider {
  currentDek(employeeId: string): Promise<{ version: number; key: Uint8Array }>;
  dekFor(employeeId: string, version: number): Promise<Uint8Array>;
}

export const INITIAL_KEY_VERSION = 1;
/** Employee ids go into KMS key paths, which only accept lowercase ASCII; `:` is reserved as the version separator. */
const EMPLOYEE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function assertEmployeeId(employeeId: string): void {
  if (!EMPLOYEE_ID_PATTERN.test(employeeId)) {
    throw new RangeError(
      `employee id "${employeeId}" cannot be used in a key path (lowercase, digits, _ - only)`,
    );
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < INITIAL_KEY_VERSION) {
    throw new RangeError(`key version must be an integer >= ${INITIAL_KEY_VERSION}, got ${version}`);
  }
}

/** Dev/test {@link KeyVersionStore}; production persists versions with the rest of the enclave state. */
export class InMemoryKeyVersionStore implements KeyVersionStore {
  private readonly versions = new Map<string, number>();

  getVersion(employeeId: string): number | null {
    return this.versions.get(employeeId) ?? null;
  }

  setVersion(employeeId: string, version: number): void {
    this.versions.set(employeeId, version);
  }
}

/** Derives versioned DEKs and rotates them. Derived keys are cached in memory (they never leave the enclave). */
export class KeyRotator implements DekProvider {
  private readonly cache = new Map<string, Promise<Uint8Array>>();
  /** Serialises rotations so that two concurrent revocations cannot both read version n and both write n + 1. */
  private rotations: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dstack: DstackAgent,
    private readonly store: KeyVersionStore,
  ) {}

  /** Current version of an employee's DEK. */
  async currentVersion(employeeId: string): Promise<number> {
    assertEmployeeId(employeeId);
    const stored = await this.store.getVersion(employeeId);
    if (stored === null) return INITIAL_KEY_VERSION;
    assertVersion(stored);
    return stored;
  }

  async currentDek(employeeId: string): Promise<{ version: number; key: Uint8Array }> {
    const version = await this.currentVersion(employeeId);
    return { version, key: await this.dekFor(employeeId, version) };
  }

  /**
   * Key of a given version (to decrypt data written before a rotation).
   * @throws RangeError on a malformed id or version; AttestError("DSTACK_FAILED") when the KMS fails.
   */
  dekFor(employeeId: string, version: number): Promise<Uint8Array> {
    assertEmployeeId(employeeId);
    assertVersion(version);
    const path = ENCLAVE_KEY_PATHS.employeeDek(`${employeeId}:${version}`);
    let key = this.cache.get(path);
    if (!key) {
      key = deriveEnclaveKey(this.dstack, path);
      // Do not cache a failure: the next call retries the KMS.
      key.catch(() => this.cache.delete(path));
      this.cache.set(path, key);
    }
    return key;
  }

  /** Moves the employee to a new DEK version and returns it. Data encrypted afterwards uses the new key. */
  rotate(employeeId: string): Promise<number> {
    const rotation = this.rotations.then(async () => {
      const next = (await this.currentVersion(employeeId)) + 1;
      await this.store.setVersion(employeeId, next);
      return next;
    });
    this.rotations = rotation.catch(() => undefined);
    return rotation;
  }
}
