import type { ConsentHistoryView, ConsentRequestView, RequestStatus } from "./types";

/** The history entry of a decided request: what the owner's list shows, without the excerpt text. */
export function consentHistoryEntry(
  request: ConsentRequestView,
  status: Exclude<RequestStatus, "pending">,
): ConsentHistoryView {
  return {
    id: request.id,
    requester: request.requester,
    excerptLabel: request.message.excerptLabel,
    flagged: request.findings.length > 0,
    status,
    createdAt: request.createdAt,
  };
}
