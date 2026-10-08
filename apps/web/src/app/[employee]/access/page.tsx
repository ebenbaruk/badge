import { KeyRound, RotateCcwKey, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { LedgerActionButton } from "@/components/ledger/sign-buttons";
import { EmptyState, PageHeader, SectionTitle } from "@/components/page-header";
import { EmployeeAvatar } from "@/components/shell/employee-avatar";
import { CopyableHash } from "@/components/copyable-hash";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EMPLOYEES, type EmployeeId } from "@/lib/directory";
import { formatDateTime, formatRelative } from "@/lib/format";
import { revokeAllFor, revokeGrant } from "@/server/actions/agreements";
import { enclave, type GrantView } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";

export const metadata: Metadata = { title: "Access & revocation" };

function isActive(grant: GrantView, now: Date): boolean {
  return grant.status === "active" && new Date(grant.expiresAt) > now;
}

function typeLabel(grant: GrantView): string {
  if (grant.kind === "share") return "One-time";
  return grant.uses === undefined ? "Standing" : `Standing · ${grant.uses} use${grant.uses === 1 ? "" : "s"}`;
}

function GrantsTable({ grants, owner, active }: { grants: GrantView[]; owner: EmployeeId; active: boolean }) {
  return (
    <div className="app-enter overflow-hidden rounded-3xl border bg-card">
      <Table className="table-fixed">
        <TableHeader className="bg-surface/60 [&_th]:mono-label [&_th]:text-[10px] [&_th]:text-muted-foreground">
          <TableRow>
            <TableHead className="w-40 pl-4">Recipient</TableHead>
            <TableHead>Access</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-32">{active ? "Expires" : "Ended"}</TableHead>
            <TableHead className="w-28">ID</TableHead>
            {active && <TableHead className="w-30 pr-4 text-right" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {grants.map((grant) => (
            <TableRow key={grant.id} className={active ? undefined : "text-muted-foreground"}>
              <TableCell className="pl-4">
                <div className="flex min-w-0 items-center gap-2">
                  {grant.recipient !== undefined && <EmployeeAvatar employee={grant.recipient} size="sm" />}
                  <span className="truncate font-medium">{grant.recipientLabel}</span>
                </div>
              </TableCell>
              <TableCell className="truncate" title={grant.label}>
                {grant.label}
              </TableCell>
              <TableCell>{typeLabel(grant)}</TableCell>
              <TableCell className="text-muted-foreground">
                {active
                  ? formatRelative(grant.expiresAt)
                  : grant.status === "revoked"
                    ? "Revoked"
                    : `Expired ${formatDateTime(grant.expiresAt)}`}
              </TableCell>
              <TableCell>
                <CopyableHash value={grant.id} />
              </TableCell>
              {active && (
                <TableCell className="pr-4 text-right">
                  <LedgerActionButton
                    label="Revoke"
                    size="sm"
                    variant="outline"
                    icon={<Undo2 />}
                    reviewLabel={`Revoke access for ${grant.recipientLabel}`}
                    action={revokeGrant.bind(null, { employee: owner, grantId: grant.id })}
                    successMessage="Access revoked. The next request will need new consent."
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** One signature to cut everything shared with a colleague (and the standing agreements granted to their team). */
function RevokeAllBar({ owner, recipients }: { owner: EmployeeId; recipients: readonly EmployeeId[] }) {
  if (recipients.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {recipients.map((recipient) => (
        <LedgerActionButton
          key={recipient}
          label={`Revoke everything for ${EMPLOYEES[recipient].firstName}`}
          size="sm"
          variant="destructive"
          icon={<Undo2 />}
          reviewLabel={`Revoke everything I shared with ${EMPLOYEES[recipient].name}`}
          action={revokeAllFor.bind(null, { employee: owner, recipient })}
          successMessage={`Everything you shared with ${EMPLOYEES[recipient].firstName} is revoked; your data key has been rotated.`}
        />
      ))}
    </div>
  );
}

export default async function AccessPage({ params }: { params: Promise<{ employee: string }> }) {
  const owner = await employeeFromParams(params);
  const grants = await load(() => enclave().listGrants(owner.id));
  if (!grants.ok) return <EnclaveUnavailable failure={grants} employee={owner.id} />;
  const now = new Date();
  const active = grants.data.filter((g) => isActive(g, now));
  const ended = grants.data.filter((g) => !isActive(g, now));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Access & revocation"
        eyebrow="One signature stops it all"
        description="Everything you have granted, in one place. A revocation is signed on your Ledger: the enclave voids the consent and rotates the encryption key of your data, so the next request needs new consent."
      />
      <div className="mb-10 flex items-start gap-4 rounded-3xl bg-periwinkle p-5 text-[13px] leading-relaxed text-periwinkle-ink">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/45 ring-1 ring-white/50">
          <RotateCcwKey className="size-4" />
        </span>
        <p className="pt-1.5">
          A one-time consent covers one specific excerpt (by its fingerprint) for one task; a standing
          agreement covers a context tag for a team. Both are revoked the same way.
        </p>
      </div>
      <SectionTitle>Active access ({active.length})</SectionTitle>
      {active.length === 0 ? (
        <EmptyState icon={<KeyRound />} title="No active access">
          Nobody can use your personal context right now.
        </EmptyState>
      ) : (
        <>
          <RevokeAllBar
            owner={owner.id}
            recipients={[...new Set(active.flatMap((g) => (g.recipient === undefined ? [] : [g.recipient])))]}
          />
          <GrantsTable grants={active} owner={owner.id} active />
        </>
      )}
      {ended.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Revoked or expired</SectionTitle>
          <GrantsTable grants={ended} owner={owner.id} active={false} />
        </section>
      )}
    </div>
  );
}
