import { z } from "zod";
import { parseRow, type Database } from "../db";

const ComplianceKeyRowSchema = z.object({
  id: z.number().int(),
  employee_id: z.string(),
  /** X25519 public key, lowercase hex without prefix. */
  public_key: z.string().regex(/^[0-9a-f]{64}$/),
  registered_ms: z.number().int(),
});
export type ComplianceKeyRow = z.infer<typeof ComplianceKeyRowSchema>;

/** X25519 public keys registered by the compliance officer; the most recent one is the sealing key. */
export class ComplianceKeyRepository {
  constructor(private readonly db: Database) {}

  /** Returns the stored row. */
  insert(row: {
    employeeId: string;
    publicKey: string;
    signature: `0x${string}`;
    nowMs: number;
  }): ComplianceKeyRow {
    const result = this.db
      .prepare(
        "INSERT INTO compliance_keys (employee_id, public_key, signature, registered_ms) VALUES (?, ?, ?, ?)",
      )
      .run(row.employeeId, row.publicKey, row.signature, row.nowMs);
    return {
      id: Number(result.lastInsertRowid),
      employee_id: row.employeeId,
      public_key: row.publicKey,
      registered_ms: row.nowMs,
    };
  }

  /** The current sealing key, or undefined before the compliance officer registered one. */
  latest(): ComplianceKeyRow | undefined {
    const row = this.db.prepare("SELECT * FROM compliance_keys ORDER BY id DESC LIMIT 1").get();
    return row ? parseRow(ComplianceKeyRowSchema, row) : undefined;
  }

  /** True when `publicKey` was ever registered (current or replaced). */
  wasRegistered(publicKey: string): boolean {
    return (
      this.db.prepare("SELECT 1 AS one FROM compliance_keys WHERE public_key = ?").get(publicKey) !==
      undefined
    );
  }
}
