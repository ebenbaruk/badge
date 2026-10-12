/**
 * Response shapes of the enclave API (docs/enclave-api.md, "Wire shapes"). The SDK validates every response with
 * these schemas and the enclave types its handlers with the inferred types, so a drift between both ends fails
 * loudly in tests rather than silently in the UI. Signed Badge messages inside responses are decoded with the strict
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
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);

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

/**
 * `GET /v1/me`: the caller as the directory knows them, plus the tags of their own notes (what a standing agreement
 * can cover; the enclave is the only one that knows the context it holds).
 */
export const meSchema = employeeSchema.extend({ company: z.string(), contextTags: z.array(z.string()) });
export type Me = z.infer<typeof meSchema>;

/** `POST /v1/sessions`. */
export const sessionSchema = z.object({
  sessionKey: address,
  employeeId: z.string(),
  agentName: z.string(),
  expiresAt: unixSeconds,
});
export type Session = z.infer<typeof sessionSchema>;

/** One deterministic mass-extraction rule that fired, with a plain-English explanation for the owner. */
export const riskReasonSchema = z.object({
  /** Stable rule id, e.g. `FULL_CONTEXT_REQUEST`, `OWNER_SHARE_HIGH`, `EXCERPT_OVER_CAP`. */
  code: z.string(),
  severity: z.enum(["warn", "block"]),
  message: z.string(),
});
export type RiskReason = z.infer<typeof riskReasonSchema>;

/** Outcome of the mass-extraction rules for one excerpt. */
export const riskSchema = z.object({
  level: z.enum(["ok", "warn", "block"]),
  reasons: z.array(riskReasonSchema),
});
export type Risk = z.infer<typeof riskSchema>;

/** Why an excerpt was allowed into a brief. */
export const ALLOWED_VIA = ["company", "own", "consent", "grant_reused", "policy"] as const;
export type AllowedVia = (typeof ALLOWED_VIA)[number];

/** Why an excerpt that was considered will not be used. */
export const REFUSED_REASONS = ["rejected", "expired", "revoked"] as const;
export type RefusedReason = (typeof REFUSED_REASONS)[number];

/**
 * Fields shared by every excerpt of a task. `ownerId` is an employee id or `company` (global context). The requester
 * only learns the real label of an excerpt released to them; until then it reads "Full context of <name>".
 */
const taskExcerptFields = {
  ownerId: z.string(),
  ownerName: z.string(),
  excerptLabel: z.string(),
  excerptLength: count,
};

/** An excerpt the brief is (or will be) drafted from. */
export const allowedExcerptSchema = z.object({ ...taskExcerptFields, via: z.enum(ALLOWED_VIA) });
export type AllowedExcerpt = z.infer<typeof allowedExcerptSchema>;

/** Waiting for the owner's Ledger signature. */
export const pendingExcerptSchema = z.object({
  ...taskExcerptFields,
  consentId: z.string(),
  risk: riskSchema,
});
export type PendingExcerpt = z.infer<typeof pendingExcerptSchema>;

/** Refused by the rules before reaching the owner. */
export const blockedExcerptSchema = z.object({ ...taskExcerptFields, risk: riskSchema });
export type BlockedExcerpt = z.infer<typeof blockedExcerptSchema>;

/** Declined by the owner, expired before an answer, or no longer covered after a revocation. */
export const refusedExcerptSchema = z.object({ ...taskExcerptFields, reason: z.enum(REFUSED_REASONS) });
export type RefusedExcerpt = z.infer<typeof refusedExcerptSchema>;

/** Tokens of the excerpts used by the brief vs. the whole company context (what a naive agent would send). */
export const tokenStatsSchema = z.object({ selectedTokens: count, allContextTokens: count });
export type TokenStats = z.infer<typeof tokenStatsSchema>;

/** `POST /v1/tasks`, `GET /v1/tasks/:id`. `brief` and `tokenStats` are null until no consent is pending. */
export const taskSchema = z.object({
  id: bytes32,
  taskLabel: z.string(),
  status: z.enum(["waiting_consent", "ready"]),
  allowed: z.array(allowedExcerptSchema),
  pending: z.array(pendingExcerptSchema),
  blocked: z.array(blockedExcerptSchema),
  refused: z.array(refusedExcerptSchema),
  brief: z.string().nullable(),
  tokenStats: tokenStatsSchema.nullable(),
  createdAt: unixSeconds,
});
export type Task = z.infer<typeof taskSchema>;

const person = z.object({ id: z.string(), name: z.string(), team: z.string() });

/**
 * A one-off share awaiting the owner's Ledger signature. `message` is exactly what must be signed; `excerpt.text` is
 * the owner's own text, shown so they can judge what would leave their scope.
 */
export const contextShareConsentSchema = z.object({
  kind: z.literal("ContextShare"),
  id: z.string(),
  status: z.literal("pending"),
  taskId: bytes32,
  requester: person,
  excerpt: z.object({ label: z.string(), length: count, text: z.string(), tags: z.array(z.string()) }),
  message: BADGE_WIRE_SCHEMAS.ContextShare,
  risk: riskSchema,
  createdAt: unixSeconds,
});

/**
 * An anonymous desk share awaiting the owner's signature and ZK proof. `id` is the desk request id (what
 * `approveDeskRequest` takes); the requester's identity is not disclosed, only their desk.
 */
export const deskShareConsentSchema = z.object({
  kind: z.literal("DeskShare"),
  id: bytes32,
  status: z.literal("pending"),
  recipientDesk: z.string(),
  sourceDesk: z.string(),
  ruleLabel: z.string(),
  excerpt: z.object({ label: z.string(), length: count, text: z.string() }),
  message: BADGE_WIRE_SCHEMAS.DeskShare,
  createdAt: unixSeconds,
});

export const consentRequestSchema = z.discriminatedUnion("kind", [
  contextShareConsentSchema,
  deskShareConsentSchema,
]);
export type ConsentRequest = z.infer<typeof consentRequestSchema>;
export type ContextShareConsent = z.infer<typeof contextShareConsentSchema>;
export type DeskShareConsent = z.infer<typeof deskShareConsentSchema>;

/** `GET /v1/consents`: the caller's pending requests as owner. */
export const consentListSchema = z.object({ consents: z.array(consentRequestSchema) });
/** What the enclave sends (signed messages in their JSON wire form, bigints as decimal strings). */
export type ConsentListWire = z.input<typeof consentListSchema>;

/** `POST /v1/consents/:id/approve|reject`. `grantId` (= hashBadgeMessage of the share) is set on approval. */
export const consentDecisionSchema = z.object({
  consentId: z.string(),
  status: z.enum(["approved", "rejected"]),
  grantId: bytes32.nullable(),
});
export type ConsentDecision = z.infer<typeof consentDecisionSchema>;

/** Items of `GET /v1/grants`: active one-off grants the caller gave (what they may revoke). */
export const grantSchema = z.object({
  id: bytes32,
  recipient: person,
  excerptLabel: z.string(),
  excerptLength: count,
  taskLabel: z.string(),
  expiresAt: unixSeconds,
  createdAt: unixSeconds,
});
export type Grant = z.infer<typeof grantSchema>;
export const grantListSchema = z.object({ grants: z.array(grantSchema) });

/**
 * `POST /v1/revocations/prepare`: the exact ContextRevoke to sign. Its `targetLabel` (the only field the device
 * shows with the date) names the real scope; `POST /v1/revocations` refuses any other label.
 */
export const preparedRevocationSchema = z.object({ message: BADGE_WIRE_SCHEMAS.ContextRevoke });
export type PreparedRevocation = z.infer<typeof preparedRevocationSchema>;

/** `POST /v1/revocations`. `revocationId` = hashBadgeMessage of the signed ContextRevoke. */
export const revocationResultSchema = z.object({
  revocationId: bytes32,
  revokedGrants: count,
  revokedPolicies: count,
});
export type RevocationResult = z.infer<typeof revocationResultSchema>;

/** `POST /v1/policies` and items of `GET /v1/policies`. `id` = hashBadgeMessage of the signed policy. */
export const policySchema = z.object({
  id: bytes32,
  granteeTeam: z.string(),
  contextTag: z.string(),
  purpose: z.string(),
  maxExcerptLength: count,
  expiresAt: unixSeconds,
  createdAt: unixSeconds,
  status: z.enum(["active", "revoked", "expired"]),
  uses: count,
});
export type Policy = z.infer<typeof policySchema>;
export const policyListSchema = z.object({ policies: z.array(policySchema) });

/**
 * `POST /v1/desks/join`, `GET /v1/desks/:desk`. `id` is the API id (`research`), `name` the one signed in DeskJoin
 * (`Research`). Commitments (registration order) and root are decimal field elements; root is null while empty.
 */
export const deskSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: count,
  commitments: z.array(decimal),
  root: decimal.nullable(),
  /** The caller has registered their own identity in this desk (never says which commitment is theirs). */
  joined: z.boolean(),
});
export type Desk = z.infer<typeof deskSchema>;

/** One anonymous delivery: the excerpt and the membership proof, never the owner. */
export const deskDeliverySchema = z.object({
  excerpt: z.string(),
  excerptHash: bytes32,
  proof: deskProofSchema,
});
export type DeskDelivery = z.infer<typeof deskDeliverySchema>;

/** `POST /v1/desk-requests`, `GET /v1/desk-requests/:id` (requester only). */
export const deskRequestSchema = z.object({
  id: bytes32,
  /** `expired`: every owner left the request unanswered past the DeskShare expiry (24 h). */
  status: z.enum(["waiting_share", "delivered", "no_match", "declined", "expired"]),
  ruleId: z.string(),
  ruleLabel: z.string(),
  fromDesk: z.string(),
  sourceDesk: z.string(),
  /**
   * Root of the source desk's group when the request was created (decimal): every delivery's proof is against it.
   * The requester checks each proof against this root and `hashExcerpt(excerpt) === excerptHash`.
   */
  sourceRoot: decimal.nullable(),
  /** Ordered by excerpt hash: the order must not hint at who answered first. */
  deliveries: z.array(deskDeliverySchema),
  createdAt: unixSeconds,
});
export type DeskRequest = z.infer<typeof deskRequestSchema>;

/** `POST /v1/desk-requests/:id/approve|reject` (caller = asked owner). */
export const deskShareDecisionSchema = z.object({
  requestId: bytes32,
  status: z.enum(["delivered", "rejected"]),
});
export type DeskShareDecision = z.infer<typeof deskShareDecisionSchema>;

/** `POST /v1/compliance/key`. `publicKey` is X25519, lowercase hex without prefix. */
export const complianceKeySchema = z.object({
  keyId: count,
  employeeId: z.string(),
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  registeredAt: unixSeconds,
});
export type ComplianceKey = z.infer<typeof complianceKeySchema>;

/**
 * `GET /v1/compliance/key` (compliance role): the current sealing key, null before the first registration. Lets the
 * officer's client skip a registration the enclave already holds (the key is re-derived from her Ledger anyway).
 */
export const currentComplianceKeySchema = z.object({ key: complianceKeySchema.nullable() });
export type CurrentComplianceKey = z.infer<typeof currentComplianceKeySchema>;

/** One hash-chained audit entry. `data` never contains excerpt text, only hashes, lengths and ids. */
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

/**
 * `GET /v1/audit` (compliance role): a page of entries and the verification of the WHOLE chain. When valid, `head`
 * is the hash of entry `length` (genesis hash for an empty log) and `signedHead` its EIP-191 signature of
 * `auditHeadMessage` by the enclave's KMS-derived audit key (see `checkAuditHead`); both are null on a broken chain.
 */
export const auditLogSchema = z.object({
  entries: z.array(auditEntrySchema),
  chain: z.object({
    valid: z.boolean(),
    length: count,
    brokenAt: count.nullable(),
    head: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    signedHead: z
      .object({
        signer: address,
        signature: z.custom<Hex>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{130}$/.test(v)),
      })
      .nullable(),
  }),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/** `GET /v1/attestation/measurement`. */
export const measurementSchema = z.object({
  measurement: bytes32,
  composeHash: z.string().regex(/^[0-9a-f]{64}$/),
  appId: z.string(),
});
export type Measurement = z.infer<typeof measurementSchema>;
