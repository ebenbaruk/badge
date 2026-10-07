# Contrat de l'enclave (apps/enclave)

> Spécification de référence de l'API de l'enclave Badge (en anglais, partagée par l'enclave, l'application web,
> le serveur MCP et le script de démo).

## Actors & auth

- Directory (seeded by admin from infra/seed/acme.json): employees {id, name, team, role: employee|compliance, address, desks[]}.
  Company "Acme". Alice (Ventes, desk Origination), Bob (Grands comptes, desk Research), Chloe (Juridique & conformite, role compliance).
  Research desk also has 2 extra members (David, Emma: directory-only employees without a demo Ledger, whose desk
  identities are pre-registered by the seed) so the anonymity set is >= 3 (Semaphore warns groups of 1-2 are not anonymous).
  Compliance role: Chloe. Ledger addresses: alice 0x9858EfFD232B4033E47d90003D41EC34EcaEda94,
  bob 0x58A57ed9d8d624cBD12e2C467D34787555bB1b25, chloe 0x3061750d3dF69ef7B8d4407CB7f3F879Fd9d2398.
- Employee Ledger signs EIP-712 messages (packages/consent). Agents act with an AgentSession key (secp256k1, software).
- Every API call except the public routes (GET /health, GET /v1/attestation/measurement, POST /v1/channel/*,
  POST /v1/enroll, POST /v1/sessions: their bodies are Ledger-signed) is authenticated by a session-key signature
  (format in packages/client `request-auth.ts`, verified by apps/enclave `security/auth.ts`):
  headers x-badge-session (session key address), x-badge-ts (unix ms), x-badge-sig = EIP-191 personal_sign by the
  session key of the string `BADGE-REQ-V1\n{METHOD}\n{path+query}\n{ts}\n{sha256(body) lowercase hex}`.
  Reject ts skew > 60 s (401 clock_skew), replay (401 replay; cache keyed on session + signed string, not on the
  signature bytes, which are malleable; bounded, fails closed with 503 replay_cache_full), unknown/expired/revoked
  session (401 session_unknown: the domain's SessionResolver returns null). Session's employee = the caller
  (`c.var.caller: {employeeId, address, sessionKey}`). Bodies > 256 KiB: 413.
- Attested encrypted channel (packages/attest): POST /v1/channel/open {nonce, clientPk} -> {channelId, enclavePk, bundle};
  POST /v1/channel/:id {sealed} -> {sealed}; inner payload {method, path, headers, body} -> {status, contentType, body}
  dispatched to the same Hono app in-process (app.request). Inner paths must be under /v1/ (no `..`, never the
  channel itself); forwarded headers: content-type and the three x-badge-* headers. Channels live in memory (idle
  TTL 15 min, cap 10 000, 503 channel_capacity when full); unknown/expired id -> 404 channel_unknown (the SDK then
  reopens and retries once: the request was not executed); re-opening the same hello -> 409 channel_exists.
  Plain HTTP routes also exist for local dev; `requireChannel: true` (production) answers 403 channel_required to
  any /v1 call not dispatched by the channel (except the channel routes and the measurement).
- Errors: every route answers `{ error: { code, message } }` with a stable machine `code`.

## Enclave measurement

- = compose hash from dstack info() as bytes32 (simulator locally, real CVM on Phala). Exposed by GET /v1/attestation/measurement
  -> {measurement: 0x-bytes32, composeHash: hex, appId}; equal to `AttestationResult.enclaveMeasurement` of the channel.
- Every signed message must carry it; mismatch -> reject.

## Flows

1. POST /v1/enroll {signed EmployeeEnroll} (no session yet; signature by directory address; issuedAt fresh <= 10 min; nonce unused)
2. POST /v1/sessions {signed AgentSession} (employee enrolled; expiresAt <= 12 h; registers sessionKey)
3. POST /v1/tasks {task: string, taskLabel: string} by Alice's agent
   - memory.findCandidates(task) -> candidates across company + all personal scopes
   - classifier keeps relevant ones; personal data flag recorded
   - global + requester's own -> allowed
   - other owner's personal excerpt:
     existing active grant (owner, recipient, excerptHash, not expired, not revoked) -> allowed (log "grant.reused")
     matching active ContextPolicy (recipient team == granteeTeam, tag in excerpt tags, length <= max) -> allowed (log "policy.used")
     else -> ConsentRequest pending, with the exact ContextShare message prepared by the enclave
     (recipientName ASCII from directory "Alice Martin (Ventes)", excerptLabel ASCII <= 60 chars, length, taskLabel,
     expiresAt = now + 24 h, excerptHash, measurement, recipient, owner, taskId, nonce)
   - mass-extraction rules (deterministic, named constants) on every request: excerpt length, share of owner's total
     context, number of distinct owners in one task, requests per owner per hour. Outcome: ok | warn (flag shown to owner
     - compliance alert in audit) | block (refused, never reaches the owner).
       -> returns task {id, status: waiting_consent|ready, allowed[], pending[], blocked[]}
4. GET /v1/consents (caller = owner) -> pending ConsentRequests incl. message to sign + risk flags
   POST /v1/consents/:id/approve {signature} -> verify sig by owner, checkContextShare against stored excerpt text,
   nonce, not revoked -> Grant stored (id = hashBadgeMessage)
   POST /v1/consents/:id/reject
5. GET /v1/tasks/:id -> when no pending: brief = memory.draftBrief(task, allowedExcerpts) inside the enclave;
   returns brief + tokenStats {selectedTokens, allContextTokens} + sources (owner, label, how allowed)
6. POST /v1/revocations {signed ContextRevoke} -> grants (by grantId or all to recipient) revoked, policies too;
   DEK for that owner rotated (keys module); subsequent tasks need fresh consent.
7. POST /v1/policies {signed ContextPolicy}; GET /v1/policies (owner) with usage counts.
8. Desks:
   POST /v1/desks/join {signed DeskJoin} (employee must be desk member in directory) -> commitment added, new root
   GET /v1/desks/:desk -> {members count, commitments, root}
   POST /v1/desk-requests {fromDesk, task} (requester agent, member of fromDesk) -> enclave applies exchange rules table
   (rule id, source desk, recipient desk, allowed topics) and finds candidate excerpts in source desk members' context;
   creates DeskConsentRequest to the owner with the DeskShare message.
   POST /v1/desk-requests/:id/approve {signature, proof} -> verify DeskShare sig (signer in sourceDesk), ZK proof
   (root == source desk root, message = excerptHash, scope = requestId, nullifier unused) -> delivered to requester as
   {excerpt, proof, sourceDesk} without identity; audit entry stores signer identity SEALED to compliance pubkey.
   GET /v1/desk-requests/:id (requester) -> anonymous delivery.
9. Compliance (role compliance): GET /v1/audit -> entries + chain verification; compliance pubkey (X25519) registered
   by Chloe: POST /v1/compliance/key {publicKey, signature}. De-anonymisation happens client-side (Chloe decrypts with
   key derived from her Ledger signature); the reveal is logged via POST /v1/audit/reveal-notice.

## Storage (node:sqlite, file under BADGE_DATA_DIR)

employees, enrollments, sessions, used_nonces(signer, nonce), tasks, consent_requests, grants, policies, policy_uses,
revocations, desk_members(commitment), desk_requests, nullifiers(scope, nullifier), audit_log, compliance_keys.
Migrations as ordered SQL files; repositories with typed rows.

## Audit

append-only {seq, ts, type, actor, subject, data(json, never excerpt text — hashes only), prevHash, hash=sha256(prevHash|canonical)}.
verifyChain(). Types: enroll, session.open, task.created, consent.requested, consent.approved, consent.rejected,
grant.reused, policy.created, policy.used, revoke, rule.warn, rule.block, desk.join, desk.share, compliance.reveal.

## Keys

- Per-employee DEK = dstack getKey(`badge/dek/{employeeId}:{version}`), version from a persisted counter (starts at 1).
  Rotation (after a revocation) = version + 1 (`KeyRotator.rotate`); old versions stay derivable to read old data.

## Compliance key

- Chloe signs (EIP-191, Ledger) `complianceKeyDeriveMessage("Acme")`; X25519 secret = keccak256(signature), never sent.
  Registration: POST /v1/compliance/key {publicKey (hex, no prefix), signature = EIP-191 by Chloe's Ledger of
  `complianceKeyRegistrationMessage("Acme", publicKey)`} (all three in packages/attest).
- Desk share signer identity in the audit = `sealToPublicKey(compliancePk, json)` (packages/attest sealed box).

## Wire shapes (v1)

Response schemas live in packages/client `api-schemas.ts` (the SDK validates every response with them; the enclave
should type its handlers with them). Times outside signed messages are unix seconds (JSON numbers); signed messages
use the @badge/consent wire format (bigints as decimal strings).

| Route                              | Body                                               | Response                                                                                      |
| ---------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| POST /v1/enroll                    | signed EmployeeEnroll `{kind, message, signature}` | `{employee: {id, name, team, role, address, desks[]}}`                                        |
| POST /v1/sessions                  | signed AgentSession                                | `{sessionKey, employeeId, agentName, expiresAt}`                                              |
| POST /v1/tasks                     | `{task, taskLabel}`                                | Task `{id, taskLabel, status, allowed[], pending[], blocked[], brief, tokenStats, createdAt}` |
| GET /v1/tasks/:id                  |                                                    | Task (brief and tokenStats non-null once nothing is pending)                                  |
| GET /v1/consents                   |                                                    | `{consents: [ContextShare or DeskShare request {kind, id, status, message, risk, ...}]}`      |
| POST /v1/consents/:id/approve      | `{signature}`                                      | `{consentId, status: "approved", grantId}`                                                    |
| POST /v1/consents/:id/reject       | `{}`                                               | `{consentId, status: "rejected", grantId: null}`                                              |
| POST /v1/revocations               | signed ContextRevoke                               | `{revokedGrants, revokedPolicies}`                                                            |
| POST /v1/policies                  | signed ContextPolicy                               | Policy `{id, granteeTeam, contextTag, purpose, maxExcerptLength, expiresAt, status, uses}`    |
| GET /v1/policies                   |                                                    | `{policies: Policy[]}`                                                                        |
| POST /v1/desks/join                | signed DeskJoin                                    | Desk `{desk, members, commitments[], root}` (decimal strings)                                 |
| GET /v1/desks/:desk                |                                                    | Desk                                                                                          |
| POST /v1/desk-requests             | `{fromDesk, task}`                                 | DeskRequest `{id, fromDesk, sourceDesk, ruleId, status, delivery, createdAt}`                 |
| POST /v1/desk-requests/:id/approve | `{signature, proof}` (proof: @badge/zk wire)       | DeskRequest                                                                                   |
| GET /v1/desk-requests/:id          |                                                    | DeskRequest; `delivery` = `{excerpt, sourceDesk, proof}` or null, never the signer            |
| POST /v1/compliance/key            | `{publicKey, signature}`                           | `{employeeId, publicKey, registeredAt}`                                                       |
| GET /v1/audit                      |                                                    | `{entries: AuditEntry[], chain: {valid, length, brokenAt}}`                                   |
| POST /v1/audit/reveal-notice       | `{seq, reason}`                                    | AuditEntry                                                                                    |
| GET /v1/attestation/measurement    |                                                    | `{measurement, composeHash, appId}`                                                           |
