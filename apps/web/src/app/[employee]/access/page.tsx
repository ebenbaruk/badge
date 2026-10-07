import { KeyRound, RotateCcwKey, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { LedgerActionButton } from "@/components/ledger/sign-buttons";
import { EmptyState, PageHeader, SectionTitle } from "@/components/page-header";
import { EmployeeAvatar } from "@/components/shell/employee-avatar";
import { CopyableHash } from "@/components/copyable-hash";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EmployeeId } from "@/lib/directory";
import { formatDateTime, formatRelative } from "@/lib/format";
import { revokeGrant } from "@/server/actions/agreements";
import { enclave, type GrantView } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";

export const metadata: Metadata = { title: "Accès et révocation" };

function isActive(grant: GrantView, now: Date): boolean {
  return grant.revokedAt === undefined && new Date(grant.expiresAt) > now;
}

function GrantsTable({ grants, owner, active }: { grants: GrantView[]; owner: EmployeeId; active: boolean }) {
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Bénéficiaire</TableHead>
            <TableHead>Accès</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>{active ? "Expire" : "Fin"}</TableHead>
            <TableHead className="text-right">Usages</TableHead>
            <TableHead>Identifiant</TableHead>
            {active && <TableHead className="pr-4 text-right" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {grants.map((grant) => (
            <TableRow key={grant.id} className={active ? undefined : "text-muted-foreground"}>
              <TableCell className="pl-4">
                <div className="flex items-center gap-2">
                  {grant.recipient !== undefined && <EmployeeAvatar employee={grant.recipient} size="sm" />}
                  <span className="font-medium">{grant.recipientLabel}</span>
                </div>
              </TableCell>
              <TableCell className="max-w-64 truncate">{grant.label}</TableCell>
              <TableCell>{grant.kind === "share" ? "Ponctuel" : "Permanent"}</TableCell>
              <TableCell className="text-muted-foreground">
                {active
                  ? formatRelative(grant.expiresAt)
                  : grant.revokedAt !== undefined
                    ? `Révoqué ${formatRelative(grant.revokedAt)}`
                    : `Expiré le ${formatDateTime(grant.expiresAt)}`}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{grant.uses}</TableCell>
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

export default async function AccessPage({ params }: { params: Promise<{ employee: string }> }) {
  const owner = await employeeFromParams(params);
  const grants = await load(() => enclave().listGrants(owner.id));
  if (!grants.ok) return <EnclaveUnavailable failure={grants} />;
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
        <GrantsTable grants={active} owner={owner.id} active />
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
