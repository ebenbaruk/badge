import type { Route } from "next";
import { Bot, CheckCircle2, Circle, Fingerprint, RefreshCw, VenetianMask } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CopyableHash } from "@/components/copyable-hash";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { LedgerActionButton } from "@/components/ledger/sign-buttons";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { authorizeAgent, enrollEmployee } from "@/server/actions/onboarding";
import { enclave } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";
import { deviceName } from "@/server/messages";

export const metadata: Metadata = { title: "Configuration" };

function Step({
  index,
  done,
  icon,
  title,
  description,
  children,
}: {
  index: number;
  done: boolean;
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4 rounded-xl border bg-card p-5 shadow-xs">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full border",
          done ? "border-success/40 bg-success/10 text-success" : "text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Étape {index}</span>
          {done ? (
            <CheckCircle2 className="size-3.5 text-success" />
          ) : (
            <Circle className="size-3.5 text-muted-foreground/60" />
          )}
        </div>
        <h2 className="mt-0.5 text-[15px] font-semibold">{title}</h2>
        <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</div>
        <div className="mt-4">{children}</div>
      </div>
    </li>
  );
}

export default async function OnboardingPage({ params }: { params: Promise<{ employee: string }> }) {
  const employee = await employeeFromParams(params);
  const api = enclave();
  const [enrollment, attestation, desks] = await Promise.all([
    load(() => api.enrollment(employee.id)),
    load(() => api.attestation()),
    load(() => api.listDesks(employee.id)),
  ]);
  if (!enrollment.ok) return <EnclaveUnavailable failure={enrollment} />;
  if (!attestation.ok) return <EnclaveUnavailable failure={attestation} />;
  const { enrolled, session } = enrollment.data;
  const memberDesks = desks.ok ? desks.data.filter((d) => d.isMember) : [];
  const desksJoined = memberDesks.length > 0 && memberDesks.every((d) => d.joined);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Configuration"
        description={`Deux signatures sur le Ledger de ${employee.firstName} relient son identité à l'enclave attestée et délèguent à son agent le droit de faire des demandes, jamais celui de lire le contexte des autres.`}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-xs">
        <span className="text-muted-foreground">Mesure de l&apos;enclave signée dans chaque message :</span>
        <CopyableHash value={attestation.data.measurement} full />
      </div>
      <ol className="space-y-4">
        <Step
          index={1}
          done={enrolled}
          icon={<Fingerprint className="size-4" />}
          title="Associer mon Ledger à mon identité"
          description={
            <>
              Le Ledger signe « Rejoindre Badge » : entreprise Acme, identité{" "}
              <span className="font-mono text-foreground">{deviceName(employee)}</span>, mesure de
              l&apos;enclave.
            </>
          }
        >
          {enrolled ? (
            <p className="text-xs text-success">
              Inscrit{" "}
              {enrollment.data.enrolledAt === undefined ? "" : formatRelative(enrollment.data.enrolledAt)}.
            </p>
          ) : (
            <LedgerActionButton
              label="Signer sur mon Ledger"
              reviewLabel="Rejoindre Badge (EmployeeEnroll)"
              action={enrollEmployee.bind(null, { employee: employee.id })}
              successMessage="Ledger associé : vous avez rejoint Badge."
            />
          )}
        </Step>
        <Step
          index={2}
          done={session !== undefined}
          icon={<Bot className="size-4" />}
          title="Autoriser mon agent"
          description="Une clé de session est générée pour votre agent ; votre Ledger lui délègue le droit de faire des demandes pendant 12 heures."
        >
          {session !== undefined ? (
            <div className="space-y-3">
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Agent</dt>
                  <dd className="mt-0.5 font-medium">{session.agentName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Expire</dt>
                  <dd className="mt-0.5">
                    {formatDateTime(session.expiresAt)}{" "}
                    <span className="text-muted-foreground">({formatRelative(session.expiresAt)})</span>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Clé de session</dt>
                  <dd className="mt-0.5">
                    <CopyableHash value={session.sessionKey} full />
                  </dd>
                </div>
              </dl>
              <LedgerActionButton
                label="Renouveler la session"
                variant="outline"
                size="sm"
                icon={<RefreshCw />}
                reviewLabel="Autoriser mon agent (AgentSession)"
                action={authorizeAgent.bind(null, { employee: employee.id })}
                successMessage="Nouvelle session d'agent ouverte."
              />
            </div>
          ) : enrolled ? (
            <LedgerActionButton
              label="Signer sur mon Ledger"
              reviewLabel="Autoriser mon agent (AgentSession)"
              action={authorizeAgent.bind(null, { employee: employee.id })}
              successMessage="Agent autorisé pour 12 heures."
            />
          ) : (
            <p className="text-xs text-muted-foreground">Associez d&apos;abord votre Ledger.</p>
          )}
        </Step>
        {employee.desks.length > 0 && (
          <Step
            index={3}
            done={desksJoined}
            icon={<VenetianMask className="size-4" />}
            title="Rejoindre mon desk (facultatif)"
            description="Pour répondre anonymement aux autres desks : votre identité anonyme est dérivée de votre Ledger, rien n'est stocké."
          >
            <Button asChild variant="outline" size="sm">
              <Link href={`/${employee.id}/desks` as Route}>Ouvrir les desks</Link>
            </Button>
          </Step>
        )}
      </ol>
    </div>
  );
}
