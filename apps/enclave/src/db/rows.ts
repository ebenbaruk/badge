import type { z } from "zod";

/**
 * Validates a row read from SQLite against its schema. Rows come from our own tables, but a schema drift or a
 * manual edit must fail loudly here rather than flow into a policy decision as `undefined`.
 */
export function parseRow<T>(schema: z.ZodType<T>, row: unknown): T {
  return schema.parse(row);
}

/** {@link parseRow} for every row of a result set. */
export function parseRows<T>(schema: z.ZodType<T>, rows: readonly unknown[]): T[] {
  return rows.map((row) => schema.parse(row));
}
