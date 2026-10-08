/**
 * Demo dataset of the mock enclave: the same infra/seed/acme.json the real enclave ingests, validated here and
 * cross-checked against the web directory so the mock can never drift from the real demo identities.
 */
import { isAddressEqual } from "viem";
import { z } from "zod";
import acme from "../../../../../infra/seed/acme.json";
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
  /** Human label (UI) and its ASCII form is what the device shows as "Excerpt". */
  label: string;
}

export interface SeedDesk {
  id: DeskId;
  directoryMembers: EmployeeId[];
  allowedTopics: string[];
}

/** Display labels of the seeded notes; a note without one falls back to its tags. */
const NOTE_LABELS: Readonly<Record<string, string>> = {
  "company-presentation": "About Acme",
  "company-catalogue-2026": "2026 catalog",
  "company-politique-tarifaire": "Pricing policy",
  "company-organisation": "Sales organization",
  "company-client-orion": "Client profile: Orion Logistique",
  "company-actualite-salon": "Global Industrie trade show 2027",
  "alice-objectif-orion": "Goal of the Orion meeting",
  "alice-prospect-helios": "Prospect: Helios Froid",
  "bob-orion-conditions-2025": "Orion 2025 terms",
  "bob-orion-reunion-septembre": "Orion meeting, September 22",
  "bob-orion-points-attention": "Orion: watch-outs",
  "bob-perso-conges": "October leave",
  "bob-research-marche-capteurs": "Sensor market (Research desk)",
  "chloe-revue-contrats": "New framework agreement template",
  "chloe-rh-prudhommes": "Confidential HR case",
};

export interface SeedData {
  notes: SeedNote[];
  desks: SeedDesk[];
}

/** @throws ZodError or Error when the dataset and the directory disagree. */
export function loadSeed(): SeedData {
  const seed = seedSchema.parse(acme);
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
