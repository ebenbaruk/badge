import type { ReactNode } from "react";
import { AutoRefresh } from "@/components/shell/auto-refresh";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { AttestationBadge } from "@/components/shell/attestation-badge";
import { EmployeeSwitcher } from "@/components/shell/employee-switcher";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { LedgerActivityProvider } from "@/components/ledger/ledger-activity";
import { LedgerPanel } from "@/components/ledger/ledger-panel";
import { Badge } from "@/components/ui/badge";
import { serverConfig } from "@/server/config";
import { enclave } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";

export default async function EmployeeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ employee: string }>;
}) {
  const employee = await employeeFromParams(params);
  const api = enclave();
  const [attestation, consents, deskRequests, enrollment] = await Promise.all([
    load(() => api.attestation()),
    load(() => api.listConsents(employee.id)),
    load(() => api.listDeskRequests(employee.id)),
    load(() => api.enrollment(employee.id)),
  ]);
  const counts = {
    consents: consents.ok ? consents.data.filter((c) => c.status === "pending").length : 0,
    desks: deskRequests.ok ? deskRequests.data.incoming.filter((r) => r.status === "pending").length : 0,
  };
  const setupPending =
    enrollment.ok &&
    (!enrollment.data.enrolled ||
      enrollment.data.session === undefined ||
      (employee.role === "compliance" && enrollment.data.complianceKey === undefined));
  const speculosPort = new URL(serverConfig().speculosUrls[employee.id]).port;

  return (
    <LedgerActivityProvider>
      <AutoRefresh />
      <div className="flex min-h-svh">
        <AppSidebar
          employee={employee.id}
          isCompliance={employee.role === "compliance"}
          counts={counts}
          setupPending={setupPending}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md md:px-6">
            <EmployeeSwitcher current={employee.id} />
            <div className="ml-auto flex items-center gap-2">
              {api.mode === "mock" && (
                <Badge variant="outline" className="hidden text-muted-foreground sm:inline-flex">
                  Enclave fictive (développement)
                </Badge>
              )}
              <AttestationBadge
                attestation={attestation.ok ? attestation.data : null}
                {...(attestation.ok ? {} : { failure: attestation.message })}
              />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 px-4 py-8 md:px-8">{children}</main>
        </div>
        <LedgerPanel
          employee={employee.id}
          deviceLabel={`Ledger de ${employee.firstName} · Speculos :${speculosPort}`}
        />
      </div>
    </LedgerActivityProvider>
  );
}
