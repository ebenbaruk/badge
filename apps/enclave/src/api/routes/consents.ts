import { encodeBadgeMessage, signatureSchema } from "@badge/consent";
import type { Hono } from "hono";
import type { Hex } from "viem";
import { z } from "zod";
import type { BadgeEnv } from "../../security/types";
import { idParam, iso, jsonBody, parseBody } from "../http";
import type { EnclaveServices } from "../services";

const ApproveConsentSchema = z.strictObject({ signature: signatureSchema });

/** Owner-side routes: pending requests, decisions, grants, standing policies and revocations. */
export function registerConsentRoutes(app: Hono<BadgeEnv>, services: EnclaveServices): void {
  const { directory } = services.ctx;
  const person = (id: string) => {
    const employee = directory.employee(id);
    return {
      id,
      name: employee?.name ?? id,
      team: employee?.team ?? null,
      address: employee?.address ?? null,
    };
  };

  /**
   * Everything waiting for the caller's Ledger: one-off shares (with risk flags) and anonymous desk shares. The
   * owner sees their own excerpt in full: they cannot judge a request without reading what would leave.
   */
  app.get("/v1/consents", (c) => {
    const caller = c.get("caller");
    const consents = services.policy.pendingConsents(caller).map(({ row, message, excerpt }) => ({
      id: row.id,
      taskId: row.task_id,
      kind: "ContextShare" as const,
      message: encodeBadgeMessage("ContextShare", message),
      requester: person(row.recipient_id),
      excerpt: { label: excerpt.label, length: excerpt.length, text: excerpt.text, tags: excerpt.tags },
      risk: { level: excerpt.risk, reasons: excerpt.risk_reasons },
      createdAt: iso(row.created_ms),
    }));
    const deskShares = services.desks.pendingShares(caller).map(({ offer, message }) => ({
      requestId: offer.request_id,
      kind: "DeskShare" as const,
      message: encodeBadgeMessage("DeskShare", message),
      recipientDesk: message.recipientDesk,
      sourceDesk: message.sourceDesk,
      ruleLabel: message.ruleLabel,
      excerpt: { label: offer.label, length: offer.length, text: offer.text },
      createdAt: iso(offer.created_ms),
    }));
    return c.json({ consents, deskShares });
  });

  app.post("/v1/consents/:id/approve", async (c) => {
    const { signature } = await parseBody(c, ApproveConsentSchema);
    return c.json(await services.policy.approveConsent(c.get("caller"), idParam(c, "id"), signature as Hex));
  });

  app.post("/v1/consents/:id/reject", (c) =>
    c.json(services.policy.rejectConsent(c.get("caller"), idParam(c, "id"))),
  );

  /** Active one-off grants the caller gave: what they may want to revoke. */
  app.get("/v1/grants", (c) => {
    const grants = services.policy.activeGrants(c.get("caller")).map(({ grant, message }) => ({
      id: grant.id,
      recipient: person(grant.recipient_id),
      excerptLabel: message.excerptLabel,
      excerptLength: message.excerptLength,
      taskLabel: message.taskLabel,
      expiresAt: iso(grant.expires_ms),
      createdAt: iso(grant.created_ms),
    }));
    return c.json({ grants });
  });

  app.post("/v1/policies", async (c) =>
    c.json(await services.policy.createPolicy(c.get("caller"), await jsonBody(c)), 201),
  );

  app.get("/v1/policies", (c) => {
    const policies = services.policy.listPolicies(c.get("caller")).map((p) => ({
      id: p.id,
      granteeTeam: p.grantee_team,
      contextTag: p.context_tag,
      purpose: p.purpose,
      maxExcerptLength: p.max_excerpt_length,
      expiresAt: iso(p.expires_ms),
      createdAt: iso(p.created_ms),
      revokedAt: p.revoked_ms === null ? null : iso(p.revoked_ms),
      active: p.active,
      uses: p.uses,
    }));
    return c.json({ policies });
  });

  app.post("/v1/revocations", async (c) =>
    c.json(await services.policy.revoke(c.get("caller"), await jsonBody(c)), 201),
  );
}
