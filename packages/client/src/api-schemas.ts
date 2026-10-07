/**
 * Response shapes of the enclave API (docs/enclave-api.md, "Wire shapes"). The SDK validates every response with
 * these schemas, and the enclave can use them to type its handlers, so a drift between both ends fails loudly in
 * tests rather than silently in the UI. Signed Badge messages inside responses are decoded with the strict
 * `@badge/consent` wire schemas (bigints restored), ready to be shown and signed on the Ledger.
 * Times outside signed messages are unix seconds (JSON numbers).
 */
import { BADGE_WIRE_SCHEMAS } from "@badge/consent";
import { deskProofSchema } from "@badge/zk/wire";
import { isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

const address = z.custom<Address>((value) => typeof value === "string" && isAddress(value), {
  error: "must be an EVM address",
});
const bytes32 = z.custom<Hex>((value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), {
  error: "must be 0x-prefixed 32-byte hex",
});
const unixSeconds = z.number().int().nonnegative();
const count = z.number().int().nonnegative();

export const employeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  team: z.string(),
  role: z.enum(["employee", "compliance"]),
  address,
  desks: z.array(z.string()),
});
export type Employee = z.infer<typeof employeeSchema>;

/** `POST /v1/enroll`. */
export const enrollResponseSchema = z.object({ employee: employeeSchema });
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

/** `POST /v1/sessions`. */
export const sessionSchema = z.object({
  sessionKey: address,
  employeeId: z.string(),
  agentName: z.string(),
  expiresAt: unixSeconds,
});
export type Session = z.infer<typeof sessionSchema>;

/** Outcome of the deterministic mass-extraction rules for one excerpt. */
export const riskSchema = z.object({
  level: z.enum(["ok", "warn", "block"]),
  /** Ids of the rules that fired, e.g. `owner_share_too_high`. */
  flags: z.array(z.string()),
});
export type Risk = z.infer<typeof riskSchema>;

/** Why an excerpt was allowed into a brief. */
export const ALLOWED_VIA = ["company", "own", "consent", "grant_reused", "policy"] as const;
export type AllowedVia = (typeof ALLOWED_VIA)[number];

export const taskSourceSchema = z.object({
  /** Employee id, or `company` for the global context. */
  ownerId: z.string(),
  ownerName: z.string(),
  excerptLabel: z.string(),
  via: z.enum(ALLOWED_VIA),
});
export type TaskSource = z.infer<typeof taskSourceSchema>;

export const pendingExcerptSchema = z.object({
  consentId: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  excerptLabel: z.string(),
  excerptLength: count,
  risk: riskSchema,
});
export type PendingExcerpt = z.infer<typeof pendingExcerptSchema>;

export const blockedExcerptSchema = z.object({
  ownerId: z.string(),
  excerptLabel: z.string(),
  /** Id of the rule that blocked it. */
  rule: z.string(),
  reason: z.string(),
});
export type BlockedExcerpt = z.infer<typeof blockedExcerptSchema>;

export const tokenStatsSchema = z.object({ selectedTokens: count, allContextTokens: count });

/** `POST /v1/tasks`, `GET /v1/tasks/:id`. `brief` and `tokenStats` are null until no consent is pending. */
export const taskSchema = z.object({
  id: bytes32,
  taskLabel: z.string(),
  status: z.enum(["waiting_consent", "ready"]),
  allowed: z.array(taskSourceSchema),
  pending: z.array(pendingExcerptSchema),
  blocked: z.array(blockedExcerptSchema),
  brief: z.string().nullable(),
  tokenStats: tokenStatsSchema.nullable(),
  createdAt: unixSeconds,
});
export type Task = z.infer<typeof taskSchema>;

const consentStatus = z.enum(["pending", "approved", "rejected", "expired"]);

/** A one-off share awaiting the owner's Ledger signature. `message` is exactly what must be signed. */
export const contextShareConsentSchema = z.object({
  kind: z.literal("ContextShare"),
  id: z.string(),
  status: consentStatus,
  taskId: bytes32,
  requester: z.object({ id: z.string(), name: z.string(), team: z.string() }),
  message: BADGE_WIRE_SCHEMAS.ContextShare,
  risk: riskSchema,
  createdAt: unixSeconds,
});

/** An anonymous desk share awaiting the owner's signature and ZK proof (requester identity is not disclosed). */
export const deskShareConsentSchema = z.object({
  kind: z.literal("DeskShare"),
  id: z.string(),
  status: consentStatus,
  deskRequestId: bytes32,
  recipientDesk: z.string(),
  message: BADGE_WIRE_SCHEMAS.DeskShare,
  risk: riskSchema,
  createdAt: unixSeconds,
});

export const consentRequestSchema = z.discriminatedUnion("kind", [
  contextShareConsentSchema,
  deskShareConsentSchema,
]);
export type ConsentRequest = z.infer<typeof consentRequestSchema>;

/** `GET /v1/consents`: the caller's requests as owner. */
export const consentListSchema = z.object({ consents: z.array(consentRequestSchema) });

/** `POST /v1/consents/:id/approve|reject`. `grantId` (= hashBadgeMessage of the share) is set on approval. */
export const consentDecisionSchema = z.object({
  consentId: z.string(),
  status: z.enum(["approved", "rejected"]),
  grantId: bytes32.nullable(),
});
export type ConsentDecision = z.infer<typeof consentDecisionSchema>;

/** `POST /v1/revocations`. */
export const revocationResultSchema = z.object({ revokedGrants: count, revokedPolicies: count });
export type RevocationResult = z.infer<typeof revocationResultSchema>;

/** `POST /v1/policies` and items of `GET /v1/policies`. `id` = hashBadgeMessage of the signed policy. */
export const policySchema = z.object({
  id: bytes32,
  granteeTeam: z.string(),
  contextTag: z.string(),
  purpose: z.string(),
  maxExcerptLength: count,
  expiresAt: unixSeconds,
  status: z.enum(["active", "revoked", "expired"]),
  uses: count,
});
export type Policy = z.infer<typeof policySchema>;
export const policyListSchema = z.object({ policies: z.array(policySchema) });

/** `POST /v1/desks/join`, `GET /v1/desks/:desk`. Commitments and root are decimal field elements. */
export const deskSchema = z.object({
  desk: z.string(),
  members: count,
  commitments: z.array(z.string().regex(/^(0|[1-9][0-9]*)$/)),
  root: z.string().regex(/^(0|[1-9][0-9]*)$/),
});
export type Desk = z.infer<typeof deskSchema>;

/** `POST /v1/desk-requests`, `GET /v1/desk-requests/:id`. `delivery` never names the signer. */
export const deskRequestSchema = z.object({
  id: bytes32,
  fromDesk: z.string(),
  sourceDesk: z.string(),
  ruleId: z.string(),
  status: z.enum(["pending", "delivered", "refused"]),
  delivery: z
    .object({
      excerpt: z.string(),
      sourceDesk: z.string(),
      proof: deskProofSchema,
    })
    .nullable(),
  createdAt: unixSeconds,
});
export type DeskRequest = z.infer<typeof deskRequestSchema>;

/** `POST /v1/compliance/key`. */
export const complianceKeySchema = z.object({
  employeeId: z.string(),
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  registeredAt: unixSeconds,
});
export type ComplianceKey = z.infer<typeof complianceKeySchema>;

/** One hash-chained audit entry. `data` never contains excerpt text, only hashes and ids. */
export const auditEntrySchema = z.object({
  seq: count,
  ts: unixSeconds,
  type: z.string(),
  actor: z.string(),
  subject: z.string(),
  data: z.record(z.string(), z.unknown()),
  prevHash: z.string(),
  hash: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** `GET /v1/audit` (compliance role). */
export const auditLogSchema = z.object({
  entries: z.array(auditEntrySchema),
  chain: z.object({ valid: z.boolean(), length: count, brokenAt: count.nullable() }),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/** `GET /v1/attestation/measurement`. */
export const measurementSchema = z.object({
  measurement: bytes32,
  composeHash: z.string().regex(/^[0-9a-f]{64}$/),
  appId: z.string(),
});
export type Measurement = z.infer<typeof measurementSchema>;
