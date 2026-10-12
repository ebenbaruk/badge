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

export const metadata: Metadata = { title: "Standing agreements" };

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
        title="Standing agreements"
        eyebrow="Signed once · revocable"
        description="A cure for approval fatigue: let a team use a tagged part of your context, for a specific purpose and a limited time. Excerpts stay capped, and every use is counted and logged."
      />
      <Card className="app-enter rounded-3xl [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-[22px] tracking-[-0.045em]">New agreement</CardTitle>
          <CardDescription>
            Example: &quot;the Sales team can use my Morpho notes for client briefs, for 30 days&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PolicyForm employee={owner.id} ownTeam={owner.team} tags={tags.data} />
        </CardContent>
      </Card>

      <section className="mt-10">
        <SectionTitle>My agreements ({policies.data.length})</SectionTitle>
        {policies.data.length === 0 ? (
          <EmptyState icon={<FileSignature />} title="No standing agreements">
            Without one, every use of your personal context is asked of you case by case.
          </EmptyState>
        ) : (
          <div className="app-enter overflow-hidden rounded-3xl border bg-card">
            <Table>
              <TableHeader className="bg-surface/60 [&_th]:mono-label [&_th]:text-[10px] [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="pl-4">Team</TableHead>
                  <TableHead>Context</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead className="text-right">Max / excerpt</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Uses</TableHead>
                  <TableHead className="pr-4 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.data.map((policy) => (
                  <TableRow key={policy.id} className={policy.status === "active" ? undefined : "opacity-55"}>
                    <TableCell className="pl-4 font-medium">{policy.granteeTeam}</TableCell>
                    <TableCell>
                      <span className="rounded-pill border bg-surface px-2.5 py-0.5 font-mono text-[11px]">
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
                        <span className="rounded-pill border px-2 py-0.5 mono-chip text-muted-foreground">
                          {policy.status === "revoked" ? "Revoked" : "Expired"}
                        </span>
                      ) : (
                        <LedgerActionButton
                          label="Revoke"
                          size="sm"
                          variant="outline"
                          icon={<Undo2 />}
                          reviewLabel={`Revoke the agreement with the ${policy.granteeTeam} team`}
                          action={revokeGrant.bind(null, { employee: owner.id, grantId: policy.id })}
                          successMessage="Agreement revoked: your data key has been rotated."
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
