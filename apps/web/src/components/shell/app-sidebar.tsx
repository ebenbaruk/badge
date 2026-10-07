"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  FileSignature,
  Inbox,
  KeyRound,
  ScrollText,
  Settings2,
  VenetianMask,
  type LucideIcon,
} from "lucide-react";
import { BrandLockup } from "@/components/brand";
import type { EmployeeId } from "@/lib/directory";
import { cn } from "@/lib/utils";

export type SectionId =
  "agent" | "consents" | "agreements" | "access" | "desks" | "compliance" | "onboarding";

interface NavItem {
  section: SectionId;
  label: string;
  icon: LucideIcon;
}

const MAIN_NAV: readonly NavItem[] = [
  { section: "agent", label: "Agent", icon: Bot },
  { section: "consents", label: "Demandes d'accord", icon: Inbox },
  { section: "agreements", label: "Accords permanents", icon: FileSignature },
  { section: "access", label: "Accès et révocation", icon: KeyRound },
  { section: "desks", label: "Desks", icon: VenetianMask },
];
const COMPLIANCE_ITEM: NavItem = { section: "compliance", label: "Conformité", icon: ScrollText };
const SETUP_ITEM: NavItem = { section: "onboarding", label: "Configuration", icon: Settings2 };

export interface SidebarCounts {
  consents: number;
  desks: number;
}

function NavLink({
  employee,
  item,
  count,
  attention,
}: {
  employee: EmployeeId;
  item: NavItem;
  count?: number;
  attention?: boolean;
}) {
  const pathname = usePathname();
  const href = `/${employee}/${item.section}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={href as Route}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        active && "bg-sidebar-accent text-sidebar-foreground",
      )}
    >
      <Icon className={cn("size-4 text-muted-foreground", active && "text-brand")} />
      <span className="flex-1 truncate">{item.label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-brand px-1.5 py-px text-[10px] font-semibold text-brand-foreground tabular-nums">
          {count}
        </span>
      )}
      {attention === true && <span className="size-1.5 rounded-full bg-warning" aria-label="À faire" />}
    </Link>
  );
}

export function AppSidebar({
  employee,
  isCompliance,
  counts,
  setupPending,
}: {
  employee: EmployeeId;
  isCompliance: boolean;
  counts: SidebarCounts;
  setupPending: boolean;
}) {
  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4 md:flex">
      <div className="px-1.5 pb-5">
        <BrandLockup />
      </div>
      <nav className="flex flex-col gap-0.5" aria-label="Navigation principale">
        {MAIN_NAV.map((item) => (
          <NavLink
            key={item.section}
            employee={employee}
            item={item}
            count={
              item.section === "consents"
                ? counts.consents
                : item.section === "desks"
                  ? counts.desks
                  : undefined
            }
          />
        ))}
        {isCompliance && (
          <>
            <div className="mt-4 mb-1 px-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Conformité
            </div>
            <NavLink employee={employee} item={COMPLIANCE_ITEM} />
          </>
        )}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        <NavLink employee={employee} item={SETUP_ITEM} attention={setupPending} />
      </div>
    </aside>
  );
}
