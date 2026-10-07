/**
 * zod schemas of server action inputs: actions are public HTTP endpoints, so every argument is re-validated.
 */
import { z } from "zod";
import { DESK_IDS, EMPLOYEE_IDS } from "@/lib/directory";

export const employeeIdSchema = z.enum(EMPLOYEE_IDS);
export const deskIdSchema = z.enum(DESK_IDS);
export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, { error: "identifiant 32 octets attendu" })
  .transform((value) => value as `0x${string}`);

/** Free-text task typed by the employee; bounded so a paste cannot flood the enclave. */
export const taskTextSchema = z.string().trim().min(3).max(500);
