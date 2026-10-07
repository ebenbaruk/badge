import { FileSignature, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { PolicyForm } from "@/components/agreements/policy-form";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { LedgerActionButton } from "@/components/ledger/sign-buttons";
import { EmptyState, PageHeader, SectionTitle } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import { revokeGrant } from "@/server/actions/agreements";
import { enclave } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";

export const metadata: Metadata = { title: "Accords permanents" };

export default async function AgreementsPage({ params }: { params: Promise<{ employee: string }> }) {
  const owner = await employeeFromParams(params);
  const api = enclave();
  const [policies, tags] = await Promise.all([
    load(() => api.listPolicies(owner.id)),
    load(() => api.contextTags(owner.id)),
  ]);
  if (!policies.ok) return <EnclaveUnavailable failure={policies} employee={owner.id} />;
  if (!tags.ok) return <EnclaveUnavailable failure={tags} employee={owner.id} />;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Accords permanents"
        description="Contre la fatigue de validation : autorisez une équipe à utiliser une partie étiquetée de votre contexte, pour un usage précis et une durée bornée. Les extraits restent plafonnés, chaque usage est compté et journalisé."
      />
      <Card>
        <CardHeader>
          <CardTitle>Nouvel accord</CardTitle>
          <CardDescription>
            Exemple : « l&apos;équipe Ventes peut utiliser mes notes Orion pour des briefs clients, 30 jours
            ».
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PolicyForm employee={owner.id} ownTeam={owner.team} tags={tags.data} />
        </CardContent>
      </Card>

      <section className="mt-10">
        <SectionTitle>Mes accords ({policies.data.length})</SectionTitle>
        {policies.data.length === 0 ? (
          <EmptyState icon={<FileSignature />} title="Aucun accord permanent">
            Sans accord, chaque usage de votre contexte personnel vous est demandé au cas par cas.
          </EmptyState>
        ) : (
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Équipe</TableHead>
                  <TableHead>Contexte</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead className="text-right">Max / extrait</TableHead>
                  <TableHead>Expire</TableHead>
                  <TableHead className="text-right">Utilisations</TableHead>
                  <TableHead className="pr-4 text-right">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.data.map((policy) => (
                  <TableRow key={policy.id} className={policy.status === "active" ? undefined : "opacity-55"}>
                    <TableCell className="pl-4 font-medium">{policy.granteeTeam}</TableCell>
                    <TableCell>
                      <span className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
                        {policy.contextTag}
                      </span>
                    </TableCell>
                    <TableCell>{policy.purpose}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatNumber(policy.maxExcerptLength)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(policy.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{policy.uses}</TableCell>
                    <TableCell className="pr-4 text-right">
                      {policy.status !== "active" ? (
                        <span className="text-xs text-muted-foreground">
                          {policy.status === "revoked" ? "Révoqué" : "Expiré"}
                        </span>
                      ) : (
                        <LedgerActionButton
                          label="Révoquer"
                          size="sm"
                          variant="outline"
                          icon={<Undo2 />}
                          reviewLabel={`Révoquer l'accord avec l'équipe ${policy.granteeTeam}`}
                          action={revokeGrant.bind(null, { employee: owner.id, grantId: policy.id })}
                          successMessage="Accord révoqué : la clé de vos données a été renouvelée."
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
