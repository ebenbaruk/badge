import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { EnclaveUnavailable } from "@/components/enclave-unavailable";
import { DevicePreviewCard } from "@/components/ledger/device-preview-card";
import { ApproveRejectButtons } from "@/components/ledger/sign-buttons";
import { EmptyState, PageHeader, SectionTitle } from "@/components/page-header";
import { RiskFindings } from "@/components/risk-findings";
import { EmployeeAvatar } from "@/components/shell/employee-avatar";
import { EMPLOYEES, type Employee } from "@/lib/directory";
import { formatDateTime, formatLength, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { approveConsent, rejectConsent } from "@/server/actions/consents";
import { devicePreview } from "@/server/device-preview";
import {
  enclave,
  type ConsentHistoryView,
  type ConsentRequestView,
  type RequestStatus,
} from "@/server/enclave";
import { consentHistoryEntry } from "@/server/enclave/history";
import { employeeFromParams, load } from "@/server/load";

export const metadata: Metadata = { title: "Demandes d'accord" };

const STATUS_LABEL: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: "En attente", className: "text-warning" },
  approved: { label: "Approuvé · signé sur Ledger", className: "text-success" },
  rejected: { label: "Refusé", className: "text-danger" },
  expired: { label: "Expiré", className: "text-muted-foreground" },
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mono-label text-[10px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[13px] font-semibold tracking-[-0.01em]">{children}</dd>
    </div>
  );
}

function PendingRequest({ request, owner }: { request: ConsentRequestView; owner: Employee }) {
  const requester = EMPLOYEES[request.requester];
  const flagged = request.findings.length > 0;
  const expiresAt = new Date(Number(request.message.expiresAt) * 1000).toISOString();
  return (
    <article
      className={cn(
        "app-decision-card app-enter overflow-hidden rounded-3xl border bg-card",
        flagged && "border-danger/45 ring-4 ring-danger/10",
      )}
    >
      <div className="flex items-start gap-4 border-b bg-surface/60 px-6 py-5">
        <EmployeeAvatar employee={request.requester} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-snug">
            <span className="font-semibold tracking-[-0.02em]">{requester.name}</span>
            <span className="text-muted-foreground">
              {" "}
              ({requester.team}) demande un extrait de votre contexte
            </span>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            Tâche de son agent :{" "}
            <span className="rounded-pill border bg-card px-2.5 py-0.5 font-mono text-[11.5px] text-foreground">
              {request.taskLabel}
            </span>
          </p>
        </div>
        <time className="shrink-0 mono-label text-[10px] text-muted-foreground">
          {formatRelative(request.createdAt)}
        </time>
      </div>
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* Shown first: the owner must see why the enclave flagged the request before anything else. */}
          <RiskFindings findings={request.findings} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Destinataire">{request.message.recipientName}</Fact>
            <Fact label="Extrait">{request.message.excerptLabel}</Fact>
            <Fact label="Longueur">{formatLength(request.message.excerptLength)}</Fact>
            <Fact label="Expire">
              {formatDateTime(expiresAt)}{" "}
              <span className="text-muted-foreground">({formatRelative(expiresAt)})</span>
            </Fact>
          </dl>
          <div>
            <div className="flex flex-wrap items-center gap-1.5 mono-label text-[10px] text-muted-foreground">
              Ce qui sortirait de votre contexte
              {request.excerpt.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-pill border bg-surface px-2 py-0.5 mono-chip text-foreground normal-case"
                >
                  {tag}
                </span>
              ))}
            </div>
            <p className="mt-2 max-h-40 overflow-y-auto rounded-2xl border bg-surface px-4 py-3 text-[13px] leading-relaxed whitespace-pre-line">
              {request.excerpt.text}
            </p>
          </div>
          <ApproveRejectButtons
            reviewLabel={`Partager « ${request.message.excerptLabel} » avec ${requester.name}`}
            approve={approveConsent.bind(null, { employee: owner.id, consentId: request.id })}
            reject={rejectConsent.bind(null, { employee: owner.id, consentId: request.id })}
            approvedMessage={`Accord signé : ${requester.firstName} reçoit l'extrait.`}
          />
        </div>
        <DevicePreviewCard preview={devicePreview("ContextShare", request.message)} />
      </div>
    </article>
  );
}

function HistoryRow({ request }: { request: ConsentHistoryView }) {
  const status = STATUS_LABEL[request.status];
  return (
    <li className="app-enter flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-xs transition-colors hover:bg-surface/60">
      <EmployeeAvatar employee={request.requester} size="sm" />
      <span className="font-medium">{EMPLOYEES[request.requester].name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{request.excerptLabel}</span>
      {request.flagged && (
        <span className="rounded-pill border border-danger/35 px-2 py-0.5 mono-chip text-danger">
          signalé
        </span>
      )}
      <span className={cn("font-semibold", status.className)}>{status.label}</span>
      <time className="w-28 text-right mono-label text-[10px] text-muted-foreground">
        {formatRelative(request.createdAt)}
      </time>
    </li>
  );
}

export default async function ConsentsPage({ params }: { params: Promise<{ employee: string }> }) {
  const owner = await employeeFromParams(params);
  const api = enclave();
  const consents = await load(() => Promise.all([api.listConsents(owner.id), api.consentHistory(owner.id)]));
  if (!consents.ok) return <EnclaveUnavailable failure={consents} employee={owner.id} />;
  const [requests, decided] = consents.data;
  const pending = requests.filter((c) => c.status === "pending");
  // A request that expired before any decision is listed by the enclave, not in the runtime's history.
  const history = [
    ...requests.flatMap((c) => (c.status === "pending" ? [] : [consentHistoryEntry(c, c.status)])),
    ...decided,
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Demandes d'accord"
        eyebrow="Boîte de réception · signature Ledger"
        description="Les agents de vos collègues demandent ici des extraits de votre contexte personnel. Rien ne sort de l'enclave sans votre signature : vérifiez sur votre Ledger ce que vous partagez, avec qui, et jusqu'à quand."
      />
      <SectionTitle>En attente ({pending.length})</SectionTitle>
      {pending.length === 0 ? (
        <EmptyState icon={<Inbox />} title="Aucune demande en attente">
          Quand l&apos;agent d&apos;un collègue a besoin de votre contexte, la demande apparaît ici.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {pending.map((request) => (
            <PendingRequest key={request.id} request={request} owner={owner} />
          ))}
        </div>
      )}
      {history.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Historique</SectionTitle>
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {history.map((request) => (
              <HistoryRow key={request.id} request={request} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
