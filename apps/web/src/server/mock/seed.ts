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

const seedSchema = z.object({
  employees: z.array(
    z.object({ id: z.enum(EMPLOYEE_IDS), ledgerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }),
  ),
  desks: z.array(
    z.object({
      id: z.enum(["research", "origination"]),
      members: z.array(z.enum(EMPLOYEE_IDS)),
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
  /** Human label (UI) and its ASCII form is what the device shows as "Extrait". */
  label: string;
}

export interface SeedDesk {
  id: DeskId;
  directoryMembers: EmployeeId[];
  allowedTopics: string[];
}

/** Display labels of the seeded notes; a note without one falls back to its tags. */
const NOTE_LABELS: Readonly<Record<string, string>> = {
  "company-presentation": "Présentation d'Acme",
  "company-catalogue-2026": "Catalogue 2026",
  "company-politique-tarifaire": "Politique tarifaire",
  "company-organisation": "Organisation commerciale",
  "company-client-orion": "Fiche client Orion Logistique",
  "company-actualite-salon": "Salon Global Industrie 2027",
  "alice-objectif-orion": "Objectif du rendez-vous Orion",
  "alice-prospect-helios": "Prospect Helios Froid",
  "bob-orion-conditions-2025": "Conditions Orion 2025",
  "bob-orion-reunion-septembre": "Réunion Orion du 22 septembre",
  "bob-orion-points-attention": "Orion : points d'attention",
  "bob-perso-conges": "Congés d'octobre",
  "bob-research-marche-capteurs": "Marché des capteurs (desk Research)",
  "chloe-revue-contrats": "Nouveau modèle de contrat-cadre",
  "chloe-rh-prudhommes": "Dossier RH confidentiel",
};

export interface SeedData {
  notes: SeedNote[];
  desks: SeedDesk[];
}

/** @throws ZodError or Error when the dataset and the directory disagree. */
export function loadSeed(): SeedData {
  const seed = seedSchema.parse(acme);
  for (const employee of seed.employees) {
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
      directoryMembers: desk.members,
      allowedTopics: desk.allowedTopics,
    })),
  };
}
