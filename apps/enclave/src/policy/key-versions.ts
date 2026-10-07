/**
 * SQLite-backed {@link KeyVersionStore}: the DEK version of each employee survives restarts, so a key rotated after
 * a revocation is never silently rolled back to the previous one.
 */
import { z } from "zod";
import type { Clock } from "../clock";
import { parseRow, type Database } from "../db";
import type { KeyVersionStore } from "../security/keys";

const VersionRowSchema = z.object({ version: z.number().int() });

export class SqliteKeyVersionStore implements KeyVersionStore {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  getVersion(employeeId: string): number | null {
    const row = this.db.prepare("SELECT version FROM key_versions WHERE employee_id = ?").get(employeeId);
    return row ? parseRow(VersionRowSchema, row).version : null;
  }

  setVersion(employeeId: string, version: number): void {
    this.db
      .prepare(
        "INSERT INTO key_versions (employee_id, version, updated_ms) VALUES (?, ?, ?) ON CONFLICT (employee_id) DO UPDATE SET version = excluded.version, updated_ms = excluded.updated_ms",
      )
      .run(employeeId, version, this.clock.now().getTime());
  }
}
