import {
  BadgeCheck,
  Fingerprint,
  Hourglass,
  ShieldAlert,
  ShieldCheck,
  Users,
  VenetianMask,
} from "lucide-react";
import type { Metadata } from "next";
import { CopyableHash } from "@/components/copyable-hash";
import { DeskRequestForm } from "@/components/desks/desk-request-form";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { DevicePreviewCard } from "@/components/ledger/device-preview-card";
import { ApproveRejectButtons, LedgerActionButton } from "@/components/ledger/sign-buttons";
import { EmptyState, PageHeader, SectionTitle } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DESK_NAMES, type Employee } from "@/lib/directory";
import { formatLength, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { approveDeskShare, joinDesk, rejectDeskShare } from "@/server/actions/desks";
import { devicePreview } from "@/server/device-preview";
import { enclave, type DeskConsentView, type DeskRequestView, type DeskView } from "@/server/enclave";
import { employeeFromParams, load } from "@/server/load";

export const metadata: Metadata = { title: "Desks" };

/** Semaphore considers groups of 1 or 2 not anonymous. */
const MIN_ANONYMITY_SET = 3;

function DeskCard({ desk, employee }: { desk: DeskView; employee: Employee }) {
  const anonymous = desk.commitments.length >= MIN_ANONYMITY_SET;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <VenetianMask className="size-4 text-brand" />
          Desk {desk.name}
          {desk.joined && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">
              <BadgeCheck className="size-3" />
              Identité anonyme enregistrée
            </span>
          )}
        </CardTitle>
        <CardDescription>Sujets partageables : {desk.allowedTopics.join(", ")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Identités enregistrées</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-medium whitespace-nowrap">
              <Users className="size-3.5 text-muted-foreground" />
              {desk.commitments.length} / {desk.directoryMembers} membres
              <span className={cn("text-[11px] font-normal", anonymous ? "text-success" : "text-warning")}>
                {anonymous ? "anonymat assuré" : `groupe trop petit (${MIN_ANONYMITY_SET} minimum)`}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Racine du groupe (Semaphore)</dt>
            <dd className="mt-0.5">{desk.root === null ? "—" : <CopyableHash value={desk.root} />}</dd>
          </div>
        </dl>
        {desk.isMember && !desk.joined && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
            <p className="text-xs text-muted-foreground">
              Deux validations sur votre Ledger : dériver votre identité anonyme, puis l&apos;inscrire au desk
              (une seule si elle y est déjà inscrite).
            </p>
            <LedgerActionButton
              label={`Rejoindre ${desk.name}`}
              icon={<Fingerprint />}
              reviewLabel={`Desk ${desk.name} : dérivation de l'identité anonyme puis inscription (2 messages)`}
              action={joinDesk.bind(null, { employee: employee.id, desk: desk.id })}
              successMessage={`Vous êtes inscrit au desk ${desk.name}, anonymement.`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IncomingRequest({ request, employee }: { request: DeskConsentView; employee: Employee }) {
  return (
    <article className="rounded-xl border bg-card shadow-xs">
      <div className="border-b px-5 py-4">
        <div className="text-[14px]">
          <span className="font-semibold">Le desk {DESK_NAMES[request.fromDesk]}</span>
          <span className="text-muted-foreground">
            {" "}
            demande un extrait à un membre du desk {request.message.sourceDesk}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Sous la règle d&apos;échange « {request.ruleLabel} »
        </p>
      </div>
      <div className="grid gap-5 px-5 py-4 lg:grid-cols-2">
        <div className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            Si vous acceptez, le desk {DESK_NAMES[request.fromDesk]} reçoit l&apos;extrait et une preuve ZK
            qu&apos;il vient d&apos;un membre de votre desk, sans savoir lequel. Votre identité reste scellée
            pour la conformité.
          </p>
          <div>
            <span className="text-muted-foreground">Extrait : </span>
            <span className="font-medium">{request.message.excerptLabel}</span>
            <span className="text-muted-foreground"> · {formatLength(request.message.excerptLength)}</span>
          </div>
          <ApproveRejectButtons
            approveLabel="Partager anonymement"
            reviewLabel={`Partage anonyme vers le desk ${DESK_NAMES[request.fromDesk]} (signature + preuve ZK)`}
            approve={approveDeskShare.bind(null, { employee: employee.id, requestId: request.id })}
            reject={rejectDeskShare.bind(null, { employee: employee.id, requestId: request.id })}
            approvedMessage="Partagé anonymement : preuve ZK vérifiée par l'enclave."
          />
        </div>
        <DevicePreviewCard preview={devicePreview("DeskShare", request.message)} />
      </div>
    </article>
  );
}

/** Outcomes of a desk request that ended without a delivery. */
const UNDELIVERED_LABEL: Partial<Record<DeskRequestView["status"], string>> = {
  rejected: "Refusé par le membre sollicité",
  no_match: "Aucun membre du desk ne détient d'extrait autorisé par la règle",
  expired: "Demande expirée",
};

function OutgoingRequest({ request }: { request: DeskRequestView }) {
  const delivery = request.delivery;
  return (
    <article className="rounded-xl border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Vers le desk <span className="font-medium text-foreground">{DESK_NAMES[request.toDesk]}</span>
        </span>
        <span>· {request.ruleLabel}</span>
        <span className="ml-auto">{formatRelative(request.createdAt)}</span>
      </div>
      <p className="mt-2 text-[14px]">« {request.task} »</p>
      {delivery === undefined ? (
        <div
          className={cn(
            "mt-3 inline-flex items-center gap-1.5 text-xs",
            request.status === "pending" ? "text-warning" : "text-danger",
          )}
        >
          <Hourglass className="size-3.5" />
          {UNDELIVERED_LABEL[request.status] ?? "En attente d'un membre du desk"}
        </div>
      ) : (
        <div
          className={cn(
            "mt-4 rounded-lg border p-4",
            delivery.proofVerified ? "border-success/30 bg-success/5" : "border-warning/35 bg-warning/5",
          )}
        >
          <p className="text-[13.5px] leading-relaxed">{delivery.excerpt}</p>
          <div
            className={cn(
              "mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs",
              delivery.proofVerified ? "border-success/20" : "border-warning/25",
            )}
          >
            {delivery.proofVerified ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-success">
                <ShieldCheck className="size-3.5" />
                Source : desk {DESK_NAMES[delivery.sourceDesk]} (membre anonyme, preuve ZK vérifiée)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                <ShieldAlert className="size-3.5" />
                Preuve ZK non vérifiée : ne vous fiez pas à la provenance de cet extrait
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              nullifier <CopyableHash value={delivery.nullifier} />
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              racine <CopyableHash value={delivery.root} />
            </span>
          </div>
        </div>
      )}
    </article>
  );
}

export default async function DesksPage({ params }: { params: Promise<{ employee: string }> }) {
  const employee = await employeeFromParams(params);
  const api = enclave();
  const [desks, requests] = await Promise.all([
    load(() => api.listDesks(employee.id)),
    load(() => api.listDeskRequests(employee.id)),
  ]);
  if (!desks.ok) return <EnclaveUnavailable failure={desks} employee={employee.id} />;
  if (!requests.ok) return <EnclaveUnavailable failure={requests} employee={employee.id} />;
  const myDesks = desks.data.filter((d) => d.isMember);
  const otherDesks = desks.data.filter((d) => !d.isMember && d.requestable);
  const incoming = requests.data.incoming.filter((r) => r.status === "pending");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Desks"
        description="Partage entre équipes séparées par une « muraille de Chine » : l'enclave applique les règles d'échange, la réponse prouve (preuve ZK Semaphore) qu'elle vient d'un membre du desk, sans révéler lequel. Seule la conformité peut lever l'anonymat, et cette levée est journalisée."
      />
      <SectionTitle>Mes desks</SectionTitle>
      {myDesks.length === 0 ? (
        <EmptyState icon={<VenetianMask />} title="Vous n'êtes membre d'aucun desk" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {myDesks.map((desk) => (
            <DeskCard key={desk.id} desk={desk} employee={employee} />
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Demandes adressées à votre desk ({incoming.length})</SectionTitle>
          <div className="space-y-5">
            {incoming.map((request) => (
              <IncomingRequest key={request.id} request={request} employee={employee} />
            ))}
          </div>
        </section>
      )}

      {myDesks.length > 0 && otherDesks.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Demander à un autre desk</SectionTitle>
          <div className="grid gap-4">
            {otherDesks.map((desk) => {
              const fromDesk = myDesks[0];
              if (fromDesk === undefined) return null;
              return (
                <Card key={desk.id} size="sm">
                  <CardHeader>
                    <CardTitle>
                      {fromDesk.name} → {desk.name}
                    </CardTitle>
                    <CardDescription>
                      Sujets autorisés par la règle : {desk.allowedTopics.join(", ")} ·{" "}
                      {desk.commitments.length} identités anonymes
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DeskRequestForm employee={employee.id} fromDesk={fromDesk.id} toDesk={desk.id} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {requests.data.outgoing.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Mes demandes aux autres desks</SectionTitle>
          <div className="space-y-4">
            {requests.data.outgoing.map((request) => (
              <OutgoingRequest key={request.id} request={request} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
