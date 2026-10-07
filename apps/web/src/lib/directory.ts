/**
 * Demo directory as the web app shows it (accented display names). The enclave's directory (seeded from
 * infra/seed/acme.json) is the authority on identities; addresses here must match it and are checked by the mock.
 * Client-safe: no server import.
 */
import type { Address } from "viem";

export const EMPLOYEE_IDS = ["alice", "bob", "chloe"] as const;
export type EmployeeId = (typeof EMPLOYEE_IDS)[number];

export const DESK_IDS = ["research", "origination"] as const;
export type DeskId = (typeof DESK_IDS)[number];

export type EmployeeRole = "employee" | "compliance";

export interface Employee {
  id: EmployeeId;
  /** Display name, accents allowed (the web UI is not the device). */
  name: string;
  firstName: string;
  team: string;
  role: EmployeeRole;
  /** Ledger address of the employee's device (BIP-44 account 0). */
  address: Address;
  /** Desks the employee belongs to in the directory. */
  desks: readonly DeskId[];
  initials: string;
}

export const COMPANY_NAME = "Acme";

export const EMPLOYEES: Readonly<Record<EmployeeId, Employee>> = {
  alice: {
    id: "alice",
    name: "Alice Martin",
    firstName: "Alice",
    team: "Ventes",
    role: "employee",
    address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    desks: ["origination"],
    initials: "AM",
  },
  bob: {
    id: "bob",
    name: "Bob Durand",
    firstName: "Bob",
    team: "Grands comptes",
    role: "employee",
    address: "0x58A57ed9d8d624cBD12e2C467D34787555bB1b25",
    desks: ["research"],
    initials: "BD",
  },
  chloe: {
    id: "chloe",
    name: "Chloé Bernard",
    firstName: "Chloé",
    team: "Juridique & conformité",
    role: "compliance",
    address: "0x3061750d3dF69ef7B8d4407CB7f3F879Fd9d2398",
    desks: [],
    initials: "CB",
  },
};

export const DESK_NAMES: Readonly<Record<DeskId, string>> = {
  research: "Research",
  origination: "Origination",
};

/** Teams that can be granted a standing agreement, in display form. */
export const TEAMS = ["Ventes", "Grands comptes", "Juridique & conformité"] as const;

/** Whose whole context each employee's compromised agent asks for in the demo (always a colleague). */
export const COMPROMISED_AGENT_TARGET: Readonly<Record<EmployeeId, EmployeeId>> = {
  alice: "bob",
  bob: "alice",
  chloe: "bob",
};

/** Narrows an untrusted route segment to a known employee id. */
export function isEmployeeId(value: string): value is EmployeeId {
  return (EMPLOYEE_IDS as readonly string[]).includes(value);
}

export function isDeskId(value: string): value is DeskId {
  return (DESK_IDS as readonly string[]).includes(value);
}
