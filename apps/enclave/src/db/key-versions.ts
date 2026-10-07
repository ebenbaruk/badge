import { z } from "zod";
import type { KeyVersionStore } from "../security/keys";
import type { Database } from "./database";
import { parseRow } from "./rows";

const VersionRowSchema = z.object({ version: z.number().int() });

/** {@link KeyVersionStore} on the enclave database (table `key_versions`): rotations survive a restart. */
export class SqliteKeyVersionStore implements KeyVersionStore {
  constructor(private readonly db: Database) {}

  getVersion(employeeId: string): number | null {
    const row = this.db.prepare("SELECT version FROM key_versions WHERE employee_id = ?").get(employeeId);
    return row === undefined ? null : parseRow(VersionRowSchema, row).version;
  }

  setVersion(employeeId: string, version: number): void {
    this.db
      .prepare(
        "INSERT INTO key_versions (employee_id, version) VALUES (?, ?) " +
          "ON CONFLICT (employee_id) DO UPDATE SET version = excluded.version",
      )
      .run(employeeId, version);
  }
}
