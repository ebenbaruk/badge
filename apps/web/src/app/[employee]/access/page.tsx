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

export const metadata: Metadata = { title: "Accès et révocation" };

function isActive(grant: GrantView, now: Date): boolean {
  return grant.status === "active" && new Date(grant.expiresAt) > now;
}

function typeLabel(grant: GrantView): string {
  if (grant.kind === "share") return "Ponctuel";
  return grant.uses === undefined
    ? "Permanent"
    : `Permanent · ${grant.uses} usage${grant.uses > 1 ? "s" : ""}`;
}

function GrantsTable({ grants, owner, active }: { grants: GrantView[]; owner: EmployeeId; active: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-40 pl-4">Bénéficiaire</TableHead>
            <TableHead>Accès</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-32">{active ? "Expire" : "Fin"}</TableHead>
            <TableHead className="w-28">Identifiant</TableHead>
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
                    ? "Révoqué"
                    : `Expiré le ${formatDateTime(grant.expiresAt)}`}
              </TableCell>
              <TableCell>
                <CopyableHash value={grant.id} />
              </TableCell>
              {active && (
                <TableCell className="pr-4 text-right">
                  <LedgerActionButton
                    label="Révoquer"
                    size="sm"
                    variant="outline"
                    icon={<Undo2 />}
                    reviewLabel={`Révoquer l'accès de ${grant.recipientLabel}`}
                    action={revokeGrant.bind(null, { employee: owner, grantId: grant.id })}
                    successMessage="Accès révoqué. La prochaine demande exigera un nouvel accord."
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
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {recipients.map((recipient) => (
        <LedgerActionButton
          key={recipient}
          label={`Tout révoquer pour ${EMPLOYEES[recipient].firstName}`}
          size="sm"
          variant="destructive"
          icon={<Undo2 />}
          reviewLabel={`Révoquer tout ce que j'ai partagé avec ${EMPLOYEES[recipient].name}`}
          action={revokeAllFor.bind(null, { employee: owner, recipient })}
          successMessage={`Tout ce que vous partagiez avec ${EMPLOYEES[recipient].firstName} est révoqué ; la clé de vos données a été renouvelée.`}
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
        title="Accès et révocation"
        description="Tout ce que vous avez accordé, au même endroit. Une révocation est signée sur votre Ledger : l'enclave invalide l'accord et renouvelle la clé de chiffrement de vos données, la demande suivante exigera un nouvel accord."
      />
      <div className="mb-8 flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground">
        <RotateCcwKey className="mt-0.5 size-4 shrink-0 text-brand" />
        <p>
          Un accord ponctuel couvre un extrait précis (par son empreinte) pour une tâche ; un accord permanent
          couvre une étiquette de contexte pour une équipe. Les deux se révoquent de la même façon.
        </p>
      </div>
      <SectionTitle>Accès actifs ({active.length})</SectionTitle>
      {active.length === 0 ? (
        <EmptyState icon={<KeyRound />} title="Aucun accès actif">
          Personne ne peut utiliser votre contexte personnel en ce moment.
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
          <SectionTitle>Révoqués ou expirés</SectionTitle>
          <GrantsTable grants={ended} owner={owner.id} active={false} />
        </section>
      )}
    </div>
  );
}
