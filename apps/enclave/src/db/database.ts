/**
 * The enclave's SQLite database (node:sqlite, built into Node 24): one file under BADGE_DATA_DIR, or ":memory:"
 * for tests. Synchronous on purpose: a statement cannot interleave with another request's statements, so a
 * transaction never spans an `await` and invariants (nonce use, grant creation) stay atomic.
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Special path of an in-memory database (tests). */
export const IN_MEMORY_DATABASE = ":memory:";

/** Wait this long for a lock held by another connection (a second process on the same file) before failing. */
const BUSY_TIMEOUT_MS = 5_000;
const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));
/** `NNN_description.sql`: the number orders the migrations and is recorded once applied. */
const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** The database handle shared by the repositories. */
export type Database = DatabaseSync;

/** A migration file could not be applied; the database is left at the previous version. */
export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

/**
 * Opens (creating if needed) the database at `path` and applies pending migrations.
 * @throws {MigrationError} when a migration fails.
 */
export function openDatabase(path: string): Database {
  if (path !== IN_MEMORY_DATABASE) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS, enableForeignKeyConstraints: true });
  if (path !== IN_MEMORY_DATABASE) db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

const AppliedVersionSchema = z.object({ version: z.number().int() });

/** Applies every migration file whose number is above the recorded version, each in its own transaction. */
export function migrate(db: Database, dir: string = MIGRATIONS_DIR): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_ms INTEGER NOT NULL) STRICT",
  );
  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => AppliedVersionSchema.parse(row).version),
  );
  const files = readdirSync(dir)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();
  for (const name of files) {
    const version = Number(MIGRATION_FILE.exec(name)?.[1]);
    if (applied.has(version)) continue;
    try {
      transaction(db, () => {
        db.exec(readFileSync(join(dir, name), "utf8"));
        db.prepare("INSERT INTO schema_migrations (version, name, applied_ms) VALUES (?, ?, ?)").run(
          version,
          name,
          Date.now(),
        );
      });
    } catch (error) {
      throw new MigrationError(`migration ${name} failed: ${(error as Error).message}`, { cause: error });
    }
  }
}

/**
 * Runs `fn` in an IMMEDIATE transaction (write lock taken up front, so two writers never deadlock on upgrade) and
 * commits, or rolls back and rethrows. `fn` must be synchronous: an `await` inside would release the event loop
 * mid-transaction and break atomicity, so a returned promise is refused.
 */
export function transaction<T>(db: Database, fn: () => T): T {
  if (db.isTransaction) {
    // Nested call: the outer transaction already provides atomicity.
    return fn();
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    if (result instanceof Promise) throw new TypeError("transaction callbacks must be synchronous");
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** True when `error` is SQLite's unique / primary-key constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed|PRIMARY KEY constraint failed/.test(error.message)
  );
}
