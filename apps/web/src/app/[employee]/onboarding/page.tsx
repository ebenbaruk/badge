import type { Route } from "next";
import { Bot, Check, Fingerprint, KeyRound, RefreshCw, VenetianMask } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { CopyableHash } from "@/components/copyable-hash";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { LedgerActionButton } from "@/components/ledger/sign-buttons";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { registerComplianceKey } from "@/server/actions/compliance";
import { authorizeAgent, enrollEmployee } from "@/server/actions/onboarding";
import { enclave } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";
import { deviceName } from "@/server/messages";

export const metadata: Metadata = { title: "Configuration" };

/** Flow step states of the reference: finished, the one to do now, or waiting on an earlier step. */
type StepState = "done" | "now" | "locked";

const STEP_CHIP: Record<StepState, string> = {
  done: "Fait",
  now: "À faire",
  locked: "Plus tard",
};

function stepState(done: boolean, unlocked: boolean): StepState {
  if (done) return "done";
  return unlocked ? "now" : "locked";
}

function Step({
  index,
  state,
  icon,
  title,
  description,
  children,
}: {
  index: number;
  state: StepState;
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      data-state={state}
      className={cn(
        "app-enter relative flex gap-5 rounded-2xl border p-6 transition-[background-color,border-color] duration-500 ease-out-soft",
        state === "now" && "border-muted-foreground/60 bg-card shadow-nav",
        state === "done" && "bg-card",
        state === "locked" && "bg-surface",
      )}
      style={{ "--i": index } as CSSProperties}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-500 ease-out-soft",
          state === "done" && "border-primary bg-primary text-primary-foreground",
          state === "now" && "border-primary text-primary",
          state === "locked" && "border-muted-foreground/40 text-muted-foreground",
        )}
      >
        {state === "done" ? <Check className="size-4" /> : icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="mono-label text-[10px] text-muted-foreground">Étape {index}</span>
          <span
            className={cn(
              "rounded-pill border px-2 py-0.5 mono-chip",
              state === "done" && "border-success/35 text-success",
              state === "now" && "border-primary/40 text-primary",
              state === "locked" && "text-muted-foreground",
            )}
          >
            {STEP_CHIP[state]}
          </span>
        </div>
        <h2 className="mt-2 text-[20px] leading-snug tracking-[-0.045em]">{title}</h2>
        <div className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{description}</div>
        <div className="mt-5">{children}</div>
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
  if (!enrollment.ok) return <EnclaveUnavailable failure={enrollment} employee={employee.id} />;
  if (!attestation.ok) return <EnclaveUnavailable failure={attestation} employee={employee.id} />;
  const { enrolled, session, complianceKey } = enrollment.data;
  const memberDesks = desks.ok ? desks.data.filter((d) => d.isMember) : [];
  const desksJoined = memberDesks.length > 0 && memberDesks.every((d) => d.joined);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Configuration"
        eyebrow="Deux signatures · une journée de travail"
        description={`Deux signatures sur le Ledger de ${employee.firstName} relient son identité à l'enclave attestée et délèguent à son agent le droit de faire des demandes, jamais celui de lire le contexte des autres.`}
      />
      <div className="mb-8 flex flex-wrap items-center gap-2 rounded-2xl bg-brand-deep px-5 py-4 text-xs text-paper [&_button]:text-paper/90 [&_button:hover]:text-paper">
        <span className="mono-label text-[10px] text-signal-hover">
          Mesure de l&apos;enclave signée dans chaque message
        </span>
        <CopyableHash value={attestation.data.measurement} full />
      </div>
      <ol className="space-y-4">
        <Step
          index={1}
          state={stepState(enrolled, true)}
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
            <p className="inline-flex rounded-pill border border-success/35 bg-success/8 px-3 py-1 text-xs font-semibold text-success">
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
          state={stepState(session !== undefined, enrolled)}
          icon={<Bot className="size-4" />}
          title="Autoriser mon agent"
          description="Une clé de session est générée pour votre agent ; votre Ledger lui délègue le droit de faire des demandes pendant une journée de travail (8 heures)."
        >
          {session !== undefined ? (
            <div className="space-y-3">
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="mono-label text-[10px] text-muted-foreground">Agent</dt>
                  <dd className="mt-1 font-medium">{session.agentName}</dd>
                </div>
                <div>
                  <dt className="mono-label text-[10px] text-muted-foreground">Expire</dt>
                  <dd className="mt-1">
                    {formatDateTime(session.expiresAt)}{" "}
                    <span className="text-muted-foreground">({formatRelative(session.expiresAt)})</span>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="mono-label text-[10px] text-muted-foreground">Clé de session</dt>
                  <dd className="mt-1">
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
              successMessage="Agent autorisé pour 8 heures."
            />
          ) : (
            <p className="text-xs text-muted-foreground">Associez d&apos;abord votre Ledger.</p>
          )}
        </Step>
        {employee.role === "compliance" && (
          <Step
            index={3}
            state={stepState(complianceKey !== undefined, session !== undefined)}
            icon={<KeyRound className="size-4" />}
            title="Enregistrer ma clé de conformité"
            description="Les identités des partages anonymes entre desks sont scellées pour vous seule. Votre clé est dérivée d'une signature de votre Ledger : elle n'est stockée nulle part et se recalcule à chaque levée d'anonymat."
          >
            {complianceKey !== undefined ? (
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="mono-label text-[10px] text-muted-foreground">Clé publique X25519</dt>
                  <dd className="mt-1">
                    <CopyableHash value={complianceKey.publicKey} full />
                  </dd>
                </div>
                <div>
                  <dt className="mono-label text-[10px] text-muted-foreground">Enregistrée</dt>
                  <dd className="mt-1">{formatRelative(complianceKey.registeredAt)}</dd>
                </div>
              </dl>
            ) : session !== undefined ? (
              <LedgerActionButton
                label="Dériver et enregistrer sur mon Ledger"
                icon={<KeyRound />}
                reviewLabel="Clé de conformité : dérivation puis enregistrement (2 messages)"
                action={registerComplianceKey.bind(null, { employee: employee.id })}
                successMessage="Clé de conformité enregistrée : les partages anonymes peuvent commencer."
              />
            ) : (
              <p className="text-xs text-muted-foreground">Autorisez d&apos;abord votre agent.</p>
            )}
          </Step>
        )}
        {employee.desks.length > 0 && (
          <Step
            index={3}
            state={stepState(desksJoined, session !== undefined)}
            icon={<VenetianMask className="size-4" />}
            title="Rejoindre mon desk"
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
