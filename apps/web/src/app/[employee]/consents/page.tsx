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
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px]">{children}</dd>
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
        "rounded-xl border bg-card shadow-xs",
        flagged && "border-danger/40 ring-1 ring-danger/15",
      )}
    >
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <EmployeeAvatar employee={request.requester} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px]">
            <span className="font-semibold">{requester.name}</span>
            <span className="text-muted-foreground">
              {" "}
              ({requester.team}) demande un extrait de votre contexte
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Tâche de son agent : <span className="font-mono text-[12px]">{request.taskLabel}</span>
          </p>
        </div>
        <time className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelative(request.createdAt)}
        </time>
      </div>
      <div className="grid gap-5 px-5 py-4 lg:grid-cols-2">
        <div className="space-y-4">
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
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              Ce qui sortirait de votre contexte
              {request.excerpt.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border bg-muted/40 px-1.5 py-px font-mono text-[10.5px]"
                >
                  {tag}
                </span>
              ))}
            </div>
            <p className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-line">
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
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
      <EmployeeAvatar employee={request.requester} size="sm" />
      <span className="font-medium">{EMPLOYEES[request.requester].name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{request.excerptLabel}</span>
      {request.flagged && <span className="text-danger">signalé</span>}
      <span className={cn("font-medium", status.className)}>{status.label}</span>
      <time className="w-28 text-right text-muted-foreground">{formatRelative(request.createdAt)}</time>
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
        description="Les agents de vos collègues demandent ici des extraits de votre contexte personnel. Rien ne sort de l'enclave sans votre signature : vérifiez sur votre Ledger ce que vous partagez, avec qui, et jusqu'à quand."
      />
      <SectionTitle>En attente ({pending.length})</SectionTitle>
      {pending.length === 0 ? (
        <EmptyState icon={<Inbox />} title="Aucune demande en attente">
          Quand l&apos;agent d&apos;un collègue a besoin de votre contexte, la demande apparaît ici.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {pending.map((request) => (
            <PendingRequest key={request.id} request={request} owner={owner} />
          ))}
        </div>
      )}
      {history.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Historique</SectionTitle>
          <ul className="divide-y rounded-xl border bg-card">
            {history.map((request) => (
              <HistoryRow key={request.id} request={request} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
