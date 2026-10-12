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
import { PulseDot } from "@/components/motion/pulse-dot";
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

/** Semaphore considers groups of 1 or 2 not anonymous; it only matters for a desk asked anonymously. */
const MIN_ANONYMITY_SET = 3;

function DeskCard({ desk, employee }: { desk: DeskView; employee: Employee }) {
  const anonymous = desk.commitments.length >= MIN_ANONYMITY_SET;
  return (
    <Card className="app-enter app-lift rounded-3xl">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2.5 text-[20px] tracking-[-0.045em]">
          <span className="flex size-8 items-center justify-center rounded-full bg-lavender text-lavender-ink">
            <VenetianMask className="size-4" />
          </span>
          Desk {desk.name}
          {desk.joined && (
            <span className="inline-flex animate-gallery-in items-center gap-1 rounded-pill border border-success/35 bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold tracking-normal text-success">
              <BadgeCheck className="size-3" />
              Anonymous identity registered
            </span>
          )}
        </CardTitle>
        <CardDescription>Shareable topics: {desk.allowedTopics.join(", ")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="mono-label text-[10px] text-muted-foreground">Registered identities</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-x-1.5 font-medium whitespace-nowrap">
              <Users className="size-3.5 text-muted-foreground" />
              {desk.commitments.length} / {desk.directoryMembers} members
              {desk.askedAnonymously && (
                <span className={cn("text-[11px] font-normal", anonymous ? "text-success" : "text-warning")}>
                  {anonymous ? "anonymity set reached" : `group too small (${MIN_ANONYMITY_SET} minimum)`}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="mono-label text-[10px] text-muted-foreground">Group root (Semaphore)</dt>
            <dd className="mt-1">{desk.root === null ? "—" : <CopyableHash value={desk.root} />}</dd>
          </div>
        </dl>
        {desk.isMember && !desk.joined && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed bg-surface/60 p-4">
            <p className="text-xs text-muted-foreground">
              Two approvals on your Ledger: derive your anonymous identity, then register it with the desk
              (just one if it is already registered).
            </p>
            <LedgerActionButton
              label={`Join ${desk.name}`}
              icon={<Fingerprint />}
              reviewLabel={`Desk ${desk.name}: derive the anonymous identity, then register (2 messages)`}
              action={joinDesk.bind(null, { employee: employee.id, desk: desk.id })}
              successMessage={`You joined the ${desk.name} desk, anonymously.`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IncomingRequest({ request, employee }: { request: DeskConsentView; employee: Employee }) {
  return (
    <article className="app-decision-card app-enter overflow-hidden rounded-3xl border bg-card">
      <div className="border-b bg-lavender px-6 py-5 text-lavender-ink">
        <div className="text-[15px] leading-snug">
          <span className="font-semibold tracking-[-0.02em]">The {DESK_NAMES[request.fromDesk]} desk</span>
          <span className="opacity-75">
            {" "}
            is asking a member of the {request.message.sourceDesk} desk for an excerpt
          </span>
        </div>
        <p className="mt-1 text-[13px] opacity-75">Under exchange rule &quot;{request.ruleLabel}&quot;</p>
      </div>
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-2">
        <div className="space-y-4 text-[13px]">
          <p className="text-muted-foreground">
            If you accept, the {DESK_NAMES[request.fromDesk]} desk receives the excerpt and a ZK proof that it
            comes from a member of your desk, without learning which one. Your identity stays sealed for
            compliance.
          </p>
          <div>
            <span className="text-muted-foreground">Excerpt: </span>
            <span className="font-medium">{request.message.excerptLabel}</span>
            <span className="text-muted-foreground"> · {formatLength(request.message.excerptLength)}</span>
          </div>
          <ApproveRejectButtons
            approveLabel="Share anonymously"
            reviewLabel={`Anonymous share to the ${DESK_NAMES[request.fromDesk]} desk (signature + ZK proof)`}
            approve={approveDeskShare.bind(null, { employee: employee.id, requestId: request.id })}
            reject={rejectDeskShare.bind(null, { employee: employee.id, requestId: request.id })}
            approvedMessage="Shared anonymously: ZK proof verified by the enclave."
          />
        </div>
        <DevicePreviewCard preview={devicePreview("DeskShare", request.message)} />
      </div>
    </article>
  );
}

/** Outcomes of a desk request that ended without a delivery. */
const UNDELIVERED_LABEL: Partial<Record<DeskRequestView["status"], string>> = {
  rejected: "Rejected by the member asked",
  no_match: "No desk member holds an excerpt allowed by the rule",
  expired: "Request expired",
};

function OutgoingRequest({ request }: { request: DeskRequestView }) {
  const delivery = request.delivery;
  return (
    <article className="app-enter rounded-3xl border bg-card p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          To the <span className="font-medium text-foreground">{DESK_NAMES[request.toDesk]}</span> desk
        </span>
        <span>· {request.ruleLabel}</span>
        <span className="ml-auto mono-label text-[10px]">{formatRelative(request.createdAt)}</span>
      </div>
      <p className="mt-3 font-heading text-[19px] leading-snug tracking-[-0.04em]">
        &ldquo;{request.task}&rdquo;
      </p>
      {delivery === undefined ? (
        <div
          className={cn(
            "mt-4 inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-semibold",
            request.status === "pending" ? "border-warning/35 text-warning" : "border-danger/35 text-danger",
          )}
        >
          {request.status === "pending" ? <PulseDot tone="live" /> : <Hourglass className="size-3.5" />}
          {UNDELIVERED_LABEL[request.status] ?? "Waiting for a desk member"}
        </div>
      ) : (
        <div
          className={cn(
            "mt-4 animate-gallery-in rounded-2xl border p-5",
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
                Source: {DESK_NAMES[delivery.sourceDesk]} desk (anonymous member, ZK proof verified)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                <ShieldAlert className="size-3.5" />
                ZK proof not verified: do not trust where this excerpt comes from
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              nullifier <CopyableHash value={delivery.nullifier} />
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              root <CopyableHash value={delivery.root} />
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
        eyebrow="Chinese wall · ZK proof"
        description="Sharing between teams separated by a Chinese wall: the enclave enforces the exchange rules, and the answer proves (Semaphore ZK proof) that it comes from a desk member without revealing which one. Only compliance can reveal the identity, and every reveal is logged."
      />
      <SectionTitle>My desks</SectionTitle>
      {myDesks.length === 0 ? (
        <EmptyState icon={<VenetianMask />} title="You are not a member of any desk" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {myDesks.map((desk) => (
            <DeskCard key={desk.id} desk={desk} employee={employee} />
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Requests to your desk ({incoming.length})</SectionTitle>
          <div className="space-y-5">
            {incoming.map((request) => (
              <IncomingRequest key={request.id} request={request} employee={employee} />
            ))}
          </div>
        </section>
      )}

      {myDesks.length > 0 && otherDesks.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Ask another desk</SectionTitle>
          <div className="grid gap-4">
            {otherDesks.map((desk) => {
              const fromDesk = myDesks[0];
              if (fromDesk === undefined) return null;
              return (
                <Card key={desk.id} className="app-enter rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-[20px] tracking-[-0.045em]">
                      {fromDesk.name} → {desk.name}
                    </CardTitle>
                    <CardDescription>
                      Topics allowed by the rule: {desk.allowedTopics.join(", ")} · {desk.commitments.length}{" "}
                      anonymous identities
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
          <SectionTitle>My requests to other desks</SectionTitle>
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
