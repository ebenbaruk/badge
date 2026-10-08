"use client";

import type { Route } from "next";
import { Check, ChevronsUpDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EMPLOYEE_IDS, EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { EmployeeAvatar } from "./employee-avatar";

/** Sections only some employees can open: switching to someone else lands on their agent instead. */
const RESTRICTED_SECTIONS: Readonly<Record<string, (id: EmployeeId) => boolean>> = {
  compliance: (id) => EMPLOYEES[id].role === "compliance",
};

/**
 * Demo control: each employee has their own agent, inbox and Ledger. Switching keeps the current section, so the
 * presenter can jump from Alice's agent to Bob's inbox and back.
 */
export function EmployeeSwitcher({ current }: { current: EmployeeId }) {
  const router = useRouter();
  const pathname = usePathname();
  const section = pathname.split("/")[2] ?? "agent";
  const employee = EMPLOYEES[current];

  const switchTo = (id: EmployeeId): void => {
    const allowed = RESTRICTED_SECTIONS[section]?.(id) ?? true;
    router.push(`/${id}/${allowed ? section : "agent"}` as Route);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2.5 pr-3 pl-1" aria-label="Changer d'employé">
          <EmployeeAvatar employee={current} />
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-[13px] font-semibold tracking-[-0.02em]">{employee.name}</span>
            <span className="block text-[11px] font-normal text-muted-foreground">{employee.team}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="mono-label text-muted-foreground">Agir en tant que</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {EMPLOYEE_IDS.map((id) => (
          <DropdownMenuItem key={id} onSelect={() => switchTo(id)} className="gap-2.5 py-2">
            <EmployeeAvatar employee={id} />
            <span className="flex-1 leading-tight">
              <span className="block text-[13px] font-medium">{EMPLOYEES[id].name}</span>
              <span className="block text-[11px] text-muted-foreground">{EMPLOYEES[id].team}</span>
            </span>
            {id === current && <Check className="text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
