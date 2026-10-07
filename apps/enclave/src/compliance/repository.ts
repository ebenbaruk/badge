import type { Hex } from "viem";
import { z } from "zod";
import { parseRow, type Database } from "../db";

const ComplianceKeyRowSchema = z.object({
  id: z.number().int(),
  employee_id: z.string(),
  public_key: z.custom<Hex>((value) => typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value)),
  issued_s: z.number().int(),
  registered_ms: z.number().int(),
});
export type ComplianceKeyRow = z.infer<typeof ComplianceKeyRowSchema>;

/** X25519 public keys registered by the compliance officer; the most recent one is the sealing key. */
export class ComplianceKeyRepository {
  constructor(private readonly db: Database) {}

  /** Returns the new key id. */
  insert(row: {
    employeeId: string;
    publicKey: Hex;
    issuedAt: number;
    signature: Hex;
    nowMs: number;
  }): number {
    const result = this.db
      .prepare(
        "INSERT INTO compliance_keys (employee_id, public_key, issued_s, signature, registered_ms) VALUES (?, ?, ?, ?, ?)",
      )
      .run(row.employeeId, row.publicKey.toLowerCase(), row.issuedAt, row.signature, row.nowMs);
    return Number(result.lastInsertRowid);
  }

  /** The current sealing key, or undefined before the compliance officer registered one. */
  latest(): ComplianceKeyRow | undefined {
    const row = this.db.prepare("SELECT * FROM compliance_keys ORDER BY id DESC LIMIT 1").get();
    return row ? parseRow(ComplianceKeyRowSchema, row) : undefined;
  }
}
