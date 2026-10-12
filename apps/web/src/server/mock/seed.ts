/**
 * Demo dataset of the mock enclave: the same infra/seed/coinbase.json the real enclave ingests, validated here and
 * cross-checked against the web directory so the mock can never drift from the real demo identities.
 */
import { isAddressEqual } from "viem";
import { z } from "zod";
import seedDataset from "../../../../../infra/seed/coinbase.json";
import { EMPLOYEE_IDS, EMPLOYEES, type DeskId, type EmployeeId } from "@/lib/directory";
import type { ContextOwner } from "../enclave/types";

const ownerSchema = z.union([z.literal("company"), z.enum(EMPLOYEE_IDS)]);

const isWebEmployee = (id: string): id is EmployeeId => (EMPLOYEE_IDS as readonly string[]).includes(id);

/** The dataset also lists employees who are not web personas (David, Emma): they only join the Research desk. */
const seedSchema = z.object({
  employees: z.array(z.object({ id: z.string(), ledgerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/) })),
  desks: z.array(
    z.object({
      id: z.enum(["research", "origination"]),
      members: z.array(z.string()),
      allowedTopics: z.array(z.string().min(1)),
    }),
  ),
  notes: z.array(
    z.object({
      id: z.string().min(1),
      ownerId: ownerSchema,
      tags: z.array(z.string().min(1)),
      text: z.string().min(1),
    }),
  ),
});

export interface SeedNote {
  id: string;
  owner: ContextOwner;
  tags: string[];
  text: string;
  /** Human label (UI only): the device shows the excerpt's own first words as "Excerpt", never this title. */
  label: string;
}

export interface SeedDesk {
  id: DeskId;
  directoryMembers: EmployeeId[];
  allowedTopics: string[];
}

/** Display labels of the seeded notes; a note without one falls back to its tags. */
const NOTE_LABELS: Readonly<Record<string, string>> = {
  "company-presentation": "About Coinbase (demo workspace)",
  "company-catalogue-2026": "Institutional catalog",
  "company-politique-tarifaire": "Pricing policy",
  "company-organisation": "Sales organization",
  "company-client-morpho": "Client profile: Morpho",
  "company-actualite-salon": "Developer day next month",
  "alice-objectif-morpho": "Goal of the Morpho meeting",
  "alice-prospect-helios": "Prospect: Helios",
  "bob-morpho-conditions-2025": "Morpho account notes",
  "bob-morpho-reunion-septembre": "Morpho meeting, last month",
  "bob-morpho-points-attention": "Morpho: watch-outs",
  "bob-perso-conges": "Leave reminder",
  "bob-research-marche-capteurs": "Lending market (Research desk)",
  "chloe-revue-contrats": "New partner agreement template",
  "chloe-rh-prudhommes": "Confidential HR case",
};

export interface SeedData {
  notes: SeedNote[];
  desks: SeedDesk[];
}

/** @throws ZodError or Error when the dataset and the directory disagree. */
export function loadSeed(): SeedData {
  const seed = seedSchema.parse(seedDataset);
  for (const employee of seed.employees) {
    if (!isWebEmployee(employee.id)) continue;
    if (!isAddressEqual(employee.ledgerAddress as `0x${string}`, EMPLOYEES[employee.id].address)) {
      throw new Error(`seed address of ${employee.id} differs from the web directory`);
    }
  }
  return {
    notes: seed.notes.map((note) => ({
      id: note.id,
      owner: note.ownerId,
      tags: note.tags,
      text: note.text,
      label: NOTE_LABELS[note.id] ?? note.tags.join(", "),
    })),
    desks: seed.desks.map((desk) => ({
      id: desk.id,
      directoryMembers: desk.members.filter(isWebEmployee),
      allowedTopics: desk.allowedTopics,
    })),
  };
}
