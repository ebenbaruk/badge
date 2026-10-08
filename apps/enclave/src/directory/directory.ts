/**
 * The company directory: who works here, in which team, with which Ledger address, on which desks, and which
 * desk-to-desk exchange rules exist. It is configuration seeded by the administrator (infra/seed/acme.json), loaded
 * once at boot and immutable while the enclave runs: identities and memberships are never taken from a request.
 */
import { readFileSync } from "node:fs";
import type { Employee as EmployeeWire } from "@badge/client";
import { isDeviceAscii, toDeviceAscii } from "@badge/consent";
import { getAddress, isAddress, isAddressEqual, type Address } from "viem";
import { z } from "zod";
import { EnclaveError } from "../errors";
import { ACME_DATASET_PATH, loadSeedDataset } from "../memory/seed-dataset";
import { OwnerIdSchema } from "../memory/types";

export const EMPLOYEE_ROLES = ["employee", "compliance"] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

const AddressSchema = z
  .string()
  .refine((value) => isAddress(value), "not an EVM address")
  .transform((value) => getAddress(value));

const deviceAsciiString = z.string().min(1).refine(isDeviceAscii, "must be device ASCII (see toDeviceAscii)");

/** The directory part of the seed dataset (the memory layer reads the notes part of the same file). */
export const DirectorySeedSchema = z.object({
  company: z.object({ id: z.string().min(1), name: deviceAsciiString }),
  employees: z.array(
    z.object({
      id: OwnerIdSchema,
      name: z.string().min(1),
      team: z.string().min(1),
      role: z.enum(EMPLOYEE_ROLES),
      ledgerAddress: AddressSchema.nullable(),
    }),
  ),
  desks: z.array(
    z.object({
      id: OwnerIdSchema,
      name: deviceAsciiString,
      members: z.array(OwnerIdSchema),
      allowedTopics: z.array(z.string().min(1)),
    }),
  ),
  exchangeRules: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,64}$/),
        /** Shown on the owner's Ledger in the DeskShare message ("Rule"). */
        label: deviceAsciiString.max(60),
        sourceDesk: OwnerIdSchema,
        recipientDesk: OwnerIdSchema,
        allowedTags: z.array(z.string().min(1)).min(1),
      }),
    )
    .default([]),
});
export type DirectorySeed = z.input<typeof DirectorySeedSchema>;

export interface Employee {
  readonly id: string;
  readonly name: string;
  readonly team: string;
  readonly role: EmployeeRole;
  /** Ledger address, or null for an employee who cannot sign (no demo Ledger). */
  readonly address: Address | null;
  readonly desks: readonly string[];
}

export interface Desk {
  readonly id: string;
  readonly name: string;
  readonly memberIds: readonly string[];
}

/** A row of the desk exchange rules table ("Chinese wall" policy): what may flow from one desk to another. */
export interface ExchangeRule {
  readonly id: string;
  readonly label: string;
  readonly sourceDesk: string;
  readonly recipientDesk: string;
  readonly allowedTags: readonly string[];
}

/** The directory is inconsistent (unknown desk, duplicate id...). */
export class DirectoryError extends Error {
  override readonly name = "DirectoryError";
}

export class Directory {
  readonly company: { readonly id: string; readonly name: string };
  readonly #employees = new Map<string, Employee>();
  readonly #desks = new Map<string, Desk>();
  readonly #rules: ExchangeRule[];

  private constructor(seed: z.output<typeof DirectorySeedSchema>) {
    this.company = seed.company;
    const deskMembers = new Map(seed.desks.map((desk) => [desk.id, new Set(desk.members)]));
    for (const desk of seed.desks) {
      this.#desks.set(desk.id, {
        id: desk.id,
        name: desk.name,
        memberIds: [...(deskMembers.get(desk.id) ?? [])],
      });
    }
    const desksOf = (employeeId: string) =>
      [...this.#desks.values()].filter((desk) => desk.memberIds.includes(employeeId)).map((desk) => desk.id);
    const all: Employee[] = seed.employees.map(({ id, name, team, role, ledgerAddress }) => ({
      id,
      name,
      team,
      role,
      address: ledgerAddress,
      desks: desksOf(id),
    }));
    for (const employee of all) {
      if (this.#employees.has(employee.id)) throw new DirectoryError(`duplicate employee id ${employee.id}`);
      this.#employees.set(employee.id, employee);
    }
    for (const desk of this.#desks.values()) {
      for (const member of desk.memberIds) {
        if (!this.#employees.has(member))
          throw new DirectoryError(`desk ${desk.id}: unknown member ${member}`);
      }
    }
    const addresses = all.flatMap((e) => (e.address ? [e.address.toLowerCase()] : []));
    if (new Set(addresses).size !== addresses.length) throw new DirectoryError("duplicate Ledger address");
    for (const rule of seed.exchangeRules) {
      for (const deskId of [rule.sourceDesk, rule.recipientDesk]) {
        if (!this.#desks.has(deskId)) throw new DirectoryError(`rule ${rule.id}: unknown desk ${deskId}`);
      }
      if (rule.sourceDesk === rule.recipientDesk) {
        throw new DirectoryError(`rule ${rule.id}: source and recipient desks must differ`);
      }
    }
    this.#rules = seed.exchangeRules;
  }

  /**
   * Builds a directory from seed data.
   * @throws {z.ZodError | DirectoryError} on malformed or inconsistent data.
   */
  static fromSeed(seed: unknown): Directory {
    return new Directory(DirectorySeedSchema.parse(seed));
  }

  /** Every employee, Ledger holders first, in seed order. */
  employees(): Employee[] {
    return [...this.#employees.values()];
  }

  employee(id: string): Employee | undefined {
    return this.#employees.get(id);
  }

  /** @throws {EnclaveError} UNKNOWN_EMPLOYEE */
  requireEmployee(id: string): Employee {
    const employee = this.#employees.get(id);
    if (!employee) throw new EnclaveError("UNKNOWN_EMPLOYEE", `no employee ${id} in the directory`);
    return employee;
  }

  /** The employee whose Ledger has `address`, if any. */
  byAddress(address: Address): Employee | undefined {
    return this.employees().find((e) => e.address !== null && isAddressEqual(e.address, address));
  }

  /** The Ledger address of `employee`. @throws {EnclaveError} FORBIDDEN for a directory-only employee. */
  requireAddress(employee: Employee): Address {
    if (!employee.address)
      throw new EnclaveError("FORBIDDEN", `${employee.id} has no Ledger and cannot sign`);
    return employee.address;
  }

  /**
   * How the API shows an employee who holds a Ledger (enrollment, GET /v1/me).
   * @throws {EnclaveError} FORBIDDEN for a directory-only employee.
   */
  profile(employee: Employee): EmployeeWire {
    return {
      id: employee.id,
      name: employee.name,
      team: employee.team,
      role: employee.role,
      address: this.requireAddress(employee),
      desks: [...employee.desks],
    };
  }

  /** Name and team of an employee for API responses; an unknown id is shown as itself (never throws). */
  person(id: string): { id: string; name: string; team: string } {
    const employee = this.#employees.get(id);
    return { id, name: employee?.name ?? id, team: employee?.team ?? "" };
  }

  teams(): Set<string> {
    return new Set(this.employees().map((e) => e.team));
  }

  /** How the employee appears on a Ledger screen: "Alice Martin (Sales)", device ASCII. */
  displayName(employee: Employee): string {
    return toDeviceAscii(`${employee.name} (${employee.team})`);
  }

  desks(): Desk[] {
    return [...this.#desks.values()];
  }

  desk(id: string): Desk | undefined {
    return this.#desks.get(id);
  }

  /** @throws {EnclaveError} NOT_FOUND */
  requireDesk(id: string): Desk {
    const desk = this.#desks.get(id);
    if (!desk) throw new EnclaveError("NOT_FOUND", `no desk ${id}`);
    return desk;
  }

  /** Desks are named in signed messages by their display name (device ASCII). */
  deskByName(name: string): Desk | undefined {
    return this.desks().find((desk) => desk.name === name);
  }

  isDeskMember(employeeId: string, deskId: string): boolean {
    return this.#desks.get(deskId)?.memberIds.includes(employeeId) ?? false;
  }

  exchangeRules(): readonly ExchangeRule[] {
    return this.#rules;
  }

  /** Rules under which `deskId` may receive context from another desk. */
  rulesForRecipient(deskId: string): ExchangeRule[] {
    return this.#rules.filter((rule) => rule.recipientDesk === deskId);
  }
}

/**
 * Loads the directory from the seed dataset. The file is first validated by the memory layer's loader (notes,
 * cross-references), then its directory part is parsed here: the memory schema strips the fields it does not use.
 */
export function loadDirectory(path: string = ACME_DATASET_PATH): Directory {
  loadSeedDataset(path);
  return Directory.fromSeed(JSON.parse(readFileSync(path, "utf8")));
}
