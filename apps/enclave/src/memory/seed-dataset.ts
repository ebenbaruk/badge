import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "../llm/env-file";
import { COMPANY_OWNER_ID, MemoryNoteSchema, NoteIdSchema, OwnerIdSchema } from "./types";

/** The demo dataset shipped with the repository (company Acme, employees alice, bob, chloe, david, emma). */
export const ACME_DATASET_PATH = resolve(REPO_ROOT, "infra/seed/acme.json");

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not an Ethereum address");

export const SeedDatasetSchema = z.object({
  company: z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string() }),
  employees: z.array(
    z.object({
      id: OwnerIdSchema,
      name: z.string().min(1),
      team: z.string().min(1),
      /** Filled by the integrator once each Speculos device address is known. */
      ledgerAddress: AddressSchema.nullable(),
    }),
  ),
  desks: z.array(
    z.object({
      id: OwnerIdSchema,
      name: z.string().min(1),
      members: z.array(OwnerIdSchema),
      allowedTopics: z.array(z.string().min(1)),
    }),
  ),
  notes: z.array(MemoryNoteSchema.required({ id: true })),
  recallChecks: z.array(
    z.object({
      task: z.string().min(1),
      requesterId: OwnerIdSchema,
      mustInclude: z.array(NoteIdSchema),
      mustExclude: z.array(NoteIdSchema),
    }),
  ),
});
export type SeedDataset = z.infer<typeof SeedDatasetSchema>;

/** The dataset is well-formed JSON but internally inconsistent. */
export class SeedDatasetError extends Error {
  override readonly name = "SeedDatasetError";
}

/**
 * Loads and validates a dataset, including cross-references (note owners, desk members, checked note ids).
 * @throws {z.ZodError | SeedDatasetError} naming the offending entry.
 */
export function loadSeedDataset(path: string = ACME_DATASET_PATH): SeedDataset {
  const dataset = SeedDatasetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const employeeIds = new Set(dataset.employees.map((e) => e.id));
  const noteIds = new Set<string>();
  for (const note of dataset.notes) {
    if (note.ownerId !== COMPANY_OWNER_ID && !employeeIds.has(note.ownerId)) {
      throw new SeedDatasetError(`note ${note.id}: unknown owner ${note.ownerId}`);
    }
    if (noteIds.has(note.id)) throw new SeedDatasetError(`duplicate note id ${note.id}`);
    noteIds.add(note.id);
  }
  for (const desk of dataset.desks) {
    for (const member of desk.members) {
      if (!employeeIds.has(member)) throw new SeedDatasetError(`desk ${desk.id}: unknown member ${member}`);
    }
  }
  for (const check of dataset.recallChecks) {
    for (const id of [...check.mustInclude, ...check.mustExclude]) {
      if (!noteIds.has(id)) throw new SeedDatasetError(`recall check "${check.task}": unknown note ${id}`);
    }
  }
  return dataset;
}
