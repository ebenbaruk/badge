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
import { PulseDot } from "@/components/motion/pulse-dot";
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
        "group flex h-9 items-center gap-2.5 rounded-pill px-3 text-[13px] font-medium text-sidebar-foreground/70 transition-[background-color,color,translate] duration-300 ease-out-soft hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        active &&
          "bg-surface-strong text-surface-strong-foreground hover:translate-x-0 hover:bg-surface-strong hover:text-surface-strong-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-4 text-muted-foreground transition-colors duration-300 group-hover:text-foreground",
          active && "text-current group-hover:text-current",
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 animate-gallery-in items-center justify-center rounded-pill bg-brand px-1.5 mono-chip text-brand-foreground tabular-nums",
            active && "bg-signal text-on-signal",
          )}
        >
          {count}
        </span>
      )}
      {attention === true && <PulseDot tone="live" label="À faire" className="size-2" />}
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
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar px-4 py-6 md:flex">
      <div className="px-2 pb-8">
        <BrandLockup />
      </div>
      <div className="mb-2 px-3 mono-label text-muted-foreground">Mon espace</div>
      <nav className="flex flex-col gap-1" aria-label="Navigation principale">
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
            <div className="mt-6 mb-2 px-3 mono-label text-muted-foreground">Conformité</div>
            <NavLink employee={employee} item={COMPLIANCE_ITEM} />
          </>
        )}
      </nav>
      <div className="mt-auto flex flex-col gap-1 border-t pt-4">
        <NavLink employee={employee} item={SETUP_ITEM} attention={setupPending} />
      </div>
    </aside>
  );
}
