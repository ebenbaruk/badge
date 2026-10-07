/**
 * Desk state: registered identity commitments (in registration order, which fixes the group root), desk requests,
 * the per-owner share offers they produce, and the persistent nullifier registry.
 */
import type { NullifierRegistry } from "@badge/zk";
import type { Hex } from "viem";
import { z } from "zod";
import { isUniqueViolation, parseRow, parseRows, type Database } from "../db";
import { EnclaveError } from "../errors";

const hex = z.custom<Hex>((value) => typeof value === "string" && /^0x[0-9a-f]*$/.test(value));

export class DeskMemberRepository {
  constructor(private readonly db: Database) {}

  /** @throws {EnclaveError} ALREADY_EXISTS when the employee or the commitment is already in the desk. */
  add(member: {
    deskId: string;
    employeeId: string;
    commitment: bigint;
    fixture: boolean;
    nowMs: number;
  }): void {
    try {
      this.db
        .prepare(
          "INSERT INTO desk_members (desk_id, employee_id, commitment, fixture, joined_ms) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          member.deskId,
          member.employeeId,
          member.commitment.toString(10),
          member.fixture ? 1 : 0,
          member.nowMs,
        );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new EnclaveError(
          "ALREADY_EXISTS",
          `${member.employeeId} or this identity already joined ${member.deskId}`,
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }

  has(deskId: string, employeeId: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 AS one FROM desk_members WHERE desk_id = ? AND employee_id = ?")
        .get(deskId, employeeId) !== undefined
    );
  }

  /** Commitments of the desk in registration order (the order that fixes the Merkle root). */
  commitments(deskId: string): bigint[] {
    const rows = this.db
      .prepare("SELECT commitment FROM desk_members WHERE desk_id = ? ORDER BY seq")
      .all(deskId);
    return parseRows(z.object({ commitment: z.string().regex(/^[0-9]+$/) }), rows).map((r) =>
      BigInt(r.commitment),
    );
  }
}

const DeskRequestRowSchema = z.object({
  id: hex,
  rule_id: z.string(),
  requester_id: z.string(),
  from_desk: z.string(),
  source_desk: z.string(),
  task: z.string(),
  created_ms: z.number().int(),
});
export type DeskRequestRow = z.infer<typeof DeskRequestRowSchema>;

const DeskOfferRowSchema = z.object({
  id: z.number().int(),
  request_id: hex,
  owner_id: z.string(),
  source_id: z.string(),
  label: z.string(),
  text: z.string(),
  excerpt_hash: hex,
  length: z.number().int(),
  message: z.string(),
  status: z.enum(["pending", "delivered", "rejected"]),
  proof: z.string().nullable(),
  nullifier: z.string().nullable(),
  created_ms: z.number().int(),
  decided_ms: z.number().int().nullable(),
});
export type DeskOfferRow = z.infer<typeof DeskOfferRowSchema>;

export class DeskRequestRepository {
  constructor(private readonly db: Database) {}

  insertRequest(row: DeskRequestRow): void {
    this.db
      .prepare(
        "INSERT INTO desk_requests (id, rule_id, requester_id, from_desk, source_desk, task, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(row.id, row.rule_id, row.requester_id, row.from_desk, row.source_desk, row.task, row.created_ms);
  }

  getRequest(id: Hex): DeskRequestRow | undefined {
    const row = this.db.prepare("SELECT * FROM desk_requests WHERE id = ?").get(id.toLowerCase());
    return row ? parseRow(DeskRequestRowSchema, row) : undefined;
  }

  insertOffer(row: Omit<DeskOfferRow, "id" | "status" | "proof" | "nullifier" | "decided_ms">): void {
    this.db
      .prepare(
        "INSERT INTO desk_offers (request_id, owner_id, source_id, label, text, excerpt_hash, length, message, status, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(
        row.request_id,
        row.owner_id,
        row.source_id,
        row.label,
        row.text,
        row.excerpt_hash,
        row.length,
        row.message,
        row.created_ms,
      );
  }

  offer(requestId: Hex, ownerId: string): DeskOfferRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM desk_offers WHERE request_id = ? AND owner_id = ?")
      .get(requestId.toLowerCase(), ownerId);
    return row ? parseRow(DeskOfferRowSchema, row) : undefined;
  }

  offersOf(requestId: Hex): DeskOfferRow[] {
    return parseRows(
      DeskOfferRowSchema,
      this.db
        .prepare("SELECT * FROM desk_offers WHERE request_id = ? ORDER BY id")
        .all(requestId.toLowerCase()),
    );
  }

  pendingForOwner(ownerId: string): DeskOfferRow[] {
    return parseRows(
      DeskOfferRowSchema,
      this.db
        .prepare("SELECT * FROM desk_offers WHERE owner_id = ? AND status = 'pending' ORDER BY id")
        .all(ownerId),
    );
  }

  /** Marks a pending offer delivered; false when it was no longer pending. */
  deliver(id: number, proof: string, nullifier: bigint, nowMs: number): boolean {
    const result = this.db
      .prepare(
        "UPDATE desk_offers SET status = 'delivered', proof = ?, nullifier = ?, decided_ms = ? WHERE id = ? AND status = 'pending'",
      )
      .run(proof, nullifier.toString(10), nowMs, id);
    return result.changes === 1;
  }

  reject(id: number, nowMs: number): boolean {
    const result = this.db
      .prepare(
        "UPDATE desk_offers SET status = 'rejected', decided_ms = ? WHERE id = ? AND status = 'pending'",
      )
      .run(nowMs, id);
    return result.changes === 1;
  }
}

/**
 * Persistent nullifier registry: the primary key (scope, nullifier) makes `consume` atomic, so two concurrent
 * verifications of the same proof can never both succeed, and a restart does not forget used nullifiers.
 */
export class SqliteNullifierRegistry implements NullifierRegistry {
  constructor(
    private readonly db: Database,
    private readonly nowMs: () => number,
  ) {}

  async consume(scope: bigint, nullifier: bigint): Promise<boolean> {
    const result = this.db
      .prepare("INSERT OR IGNORE INTO nullifiers (scope, nullifier, used_ms) VALUES (?, ?, ?)")
      .run(scope.toString(10), nullifier.toString(10), this.nowMs());
    return result.changes === 1;
  }
}
