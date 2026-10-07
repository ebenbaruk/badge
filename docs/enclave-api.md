# Contrat de l'enclave (apps/enclave)

> Spécification de référence de l'API de l'enclave Badge (en anglais, partagée par l'enclave, l'application web,
> le serveur MCP et le script de démo).

## Actors & auth

- Directory (seeded by admin from infra/seed/acme.json, loaded at boot, immutable while running): employees
  {id, name, team, role: employee|compliance, address, desks[]}. Company "Acme". Alice (Ventes, desk Origination),
  Bob (Grands comptes, desk Research), Chloe (Juridique & conformite, role compliance).
  Research desk also has 2 extra members (David, Emma: `directoryOnlyEmployees` without a Ledger, whose desk
  identities are DEMO FIXTURES derived from a public seed and registered at boot) so the anonymity set is >= 3
  (Semaphore warns groups of 1-2 are not anonymous). They can never sign anything.
  Ledger addresses: alice 0x9858EfFD232B4033E47d90003D41EC34EcaEda94,
  bob 0x58A57ed9d8d624cBD12e2C467D34787555bB1b25, chloe 0x3061750d3dF69ef7B8d4407CB7f3F879Fd9d2398.
  Exchange rules (`exchangeRules`): {id, label (device ASCII, shown on the Ledger), sourceDesk, recipientDesk,
  allowedTags[]}; demo: `rule-4` "Regle 4 - marche capteurs", research -> origination, tags marche-capteurs,
  prix-composants.
- Employee Ledger signs EIP-712 messages (packages/consent). Agents act with an AgentSession key (secp256k1, software).
- Every API call except the public ones is authenticated by a session-key signature:
  headers x-badge-session (address), x-badge-ts (unix ms), x-badge-sig = personal_sign(keccak256(method|path|ts|sha256(body))).
  Reject ts skew > 60 s, replay (ts+sig cache), unknown/expired/revoked session. Session's employee = the caller.
  Public: GET /health, GET /v1/attestation/measurement, POST /v1/enroll, POST /v1/sessions (self-authenticated by
  their Ledger signature), /v1/channel/\*. Everything else under /v1 goes through the authentication middleware
  (one middleware with an allow-list: a new route is authenticated by default).
- Code contract: the middleware sets `c.get("caller")`: `Caller {employeeId, address (Ledger), sessionKey}`, Hono env
  `BadgeEnv` (apps/enclave/src/security/types.ts). Session lookup: `SessionRepository.findActiveCaller(sessionKey, nowMs)`
  (unexpired, unrevoked session of an enrolled employee).
- Attested encrypted channel (packages/attest): POST /v1/channel/open {nonce, clientPk} -> {channelId, enclavePk, bundle};
  POST /v1/channel/:id {sealed} -> {sealed}; inner payload {method, path, headers, body} dispatched to the same Hono app
  in-process (app.request). Plain HTTP routes also exist for local dev; production config can require the channel.

## Enclave measurement

- = compose hash from dstack info() as bytes32 (simulator locally, real CVM on Phala). Exposed by
  GET /v1/attestation/measurement -> {measurement}. Inside a CVM (dstack socket present) the simulator is never used.
- Every signed message must carry it; mismatch -> reject (ENCLAVE_MISMATCH).

## Errors

Single envelope `{ "error": { "code", "message" } }`. Codes: enclave (`INVALID_REQUEST` 400, `UNAUTHENTICATED` 401,
`FORBIDDEN` / `UNKNOWN_EMPLOYEE` / `NOT_ENROLLED` 403, `NOT_FOUND` 404, `NONCE_REUSED` / `ALREADY_EXISTS` /
`NOT_PENDING` / `COMPLIANCE_KEY_MISSING` 409, `SESSION_TOO_LONG` / `STALE` / `NO_RULE` 422, `UPSTREAM_FAILED` 502),
@badge/consent codes (`INVALID_MESSAGE` 400, `SIGNATURE_MISMATCH` 403, `EXPIRED` / `ENCLAVE_MISMATCH` /
`EXCERPT_HASH_MISMATCH`... 422), @badge/zk codes (`MALFORMED_PROOF` 400, `WRONG_ROOT` / `INVALID_PROOF`... 422,
`NULLIFIER_REUSED` 409), `BODY_TOO_LARGE` 413 (64 KB), `INTERNAL` 500 (details only in the enclave log). Another
employee's resource is reported as `NOT_FOUND`.

Signed messages travel as the @badge/consent wire envelope `{kind, message, signature}` (bigints as decimal strings).

## Flows

1. POST /v1/enroll {signed EmployeeEnroll} (no session yet; signature by the directory address; company, employeeName,
   team equal to the directory (device ASCII); issuedAt fresh <= 10 min; nonce unused) -> 201 {employeeId}
2. POST /v1/sessions {signed AgentSession} (employee enrolled; expiresAt <= 12 h; sessionKey not a directory Ledger
   address; registers sessionKey; the same employee may re-delegate a key whose session ended)
   -> 201 {employeeId, sessionKey, expiresAt}
   GET /v1/me -> {employeeId, name, team, role, address, desks, company}
3. POST /v1/tasks {task: string <= 2000, taskLabel: string, requestFullContextOf?: employeeId} by Alice's agent
   - memory.findCandidates(task) -> candidates across company + all personal scopes
   - classifier keeps relevant ones; personal data flag recorded
   - requestFullContextOf: one excerpt = all of that owner's notes concatenated, label "Tout le contexte de <name>";
     not filtered by relevance (explicitly asked for), but goes through the same rules and consent (what a trapped,
     prompt-injected agent does; not special-cased otherwise)
   - global + requester's own -> allowed
   - other owner's personal excerpt:
     mass-extraction rules first: block -> blocked (never reaches the owner)
     existing active grant (owner, recipient, excerptHash, not expired, not revoked) -> allowed (log "grant.reused")
     matching active ContextPolicy (recipient team == granteeTeam, tag in excerpt tags, length <= max) and rules
     outcome ok -> allowed (log "policy.used"); a warning always goes to the owner, even with a policy
     else -> ConsentRequest pending, with the exact ContextShare message prepared by the enclave
     (recipientName ASCII from directory "Alice Martin (Ventes)", excerptLabel ASCII <= 60 chars cut from the excerpt,
     length, taskLabel (ASCII <= 60), expiresAt = now + 24 h, excerptHash, measurement, recipient, owner, taskId,
     random nonce)
   - mass-extraction rules (deterministic, named constants in src/policy/rules.ts) on every third-party request:
     excerpt length (warn > 600, block > 8000), share of owner's total context requested by the task (warn >= 90 %),
     distinct owners in one task (warn >= 3, block > 6), requests per owner per hour (warn >= 20, block >= 60), explicit
     full-context request (warn). Outcome: ok | warn (reasons shown to owner, compliance alert "rule.warn" in audit)
     | block ("rule.block", refused, never reaches the owner).
     -> 201 task {id, status: waiting_consent|ready, taskLabel, createdAt, allowed[], pending[], blocked[], refused[]}
     each excerpt {ref, ownerId, ownerName, scope, label, length, decision, basis, risk, reasons[]}. Never the text of
     another owner's excerpt; until it is released, its label is "Contexte personnel de <name>".
4. GET /v1/consents (caller = owner) -> {consents: [{id, taskId, kind: "ContextShare", message (wire, to sign),
   requester {id, name, team, address}, excerpt {label, length, text, tags}, risk {level, reasons}, createdAt}],
   deskShares: [{requestId, kind: "DeskShare", message, recipientDesk, sourceDesk, ruleLabel, excerpt, createdAt}]}
   (requests whose message expired are retired first).
   POST /v1/consents/:id/approve {signature} -> verify sig by owner, checkContextShare against stored excerpt text,
   nonce -> Grant stored (id = hashBadgeMessage) -> {consentId, grantId}
   POST /v1/consents/:id/reject -> {consentId, status: "rejected"}
   GET /v1/grants (owner) -> {grants: [{id, recipient, excerptLabel, excerptLength, taskLabel, expiresAt, createdAt}]}
5. GET /v1/tasks/:id (requester only) -> when no pending: brief = memory.draftBrief(task, allowedExcerpts) inside the
   enclave (drafted once, then cached), from excerpts whose grant/policy is still active; returns the task plus
   brief (null while pending or with nothing allowed) + tokenStats {selectedTokens, allContextTokens} (o200k_base)
   - sources [{ownerId, ownerName, label, basis}].
6. POST /v1/revocations {signed ContextRevoke} (owner's own agent) -> grantId = a grant or policy id of the owner, or
   0x0 = all grants to `recipient` (a directory address) and the policies granted to their team. The owner's DEK is
   rotated (KeyRotator) before the revocation is recorded; subsequent tasks need fresh consent.
   -> 201 {revocationId, grantsRevoked, policiesRevoked}
7. POST /v1/policies {signed ContextPolicy} (owner's own agent; granteeTeam must be a directory team, device ASCII)
   -> 201 {policyId}; GET /v1/policies (owner) -> {policies: [{id, granteeTeam, contextTag, purpose,
   maxExcerptLength, expiresAt, createdAt, revokedAt, active, uses}]}.
8. Desks (ids in the API: research, origination; names in signed messages: "Research", "Origination"):
   POST /v1/desks/join {signed DeskJoin} (signed by the caller's Ledger; employee must be desk member in directory;
   deskName = desk name) -> 201 desk view
   GET /v1/desks/:desk -> {id, name, members (registered identities), commitments[] (decimal, registration order), root}
   POST /v1/desk-requests {fromDesk, task, ruleId?} (requester agent, member of fromDesk) -> enclave applies the
   exchange rules table (rule whose recipientDesk == fromDesk; ruleId needed only if several) and finds, per member of
   the source desk who has joined it, the best candidate excerpt whose tags intersect the rule's allowedTags; creates
   one DeskConsentRequest per owner with the DeskShare message (requestId = the desk request id).
   -> 201 {id, status: waiting_share|no_match, ruleId, ruleLabel, fromDesk, sourceDesk, deliveries: []}
   POST /v1/desk-requests/:id/approve {signature, proof} (caller = asked owner) -> verify DeskShare sig (signer in
   sourceDesk), checkDeskShare against stored text, a compliance key is registered (else COMPLIANCE_KEY_MISSING), nonce
   unused, ZK proof (root == source desk root, message = excerptHash, scope = requestId, nullifier unused) -> delivered
   to requester without identity; audit entry (actor "anonymous") stores signer identity SEALED to compliance pubkey.
   POST /v1/desk-requests/:id/reject (caller = asked owner).
   GET /v1/desk-requests/:id (requester) -> {..., status: waiting_share|delivered|no_match|declined,
   deliveries: [{excerpt, excerptHash, proof, sourceDesk, ruleLabel}]} (ordered by excerpt hash, no owner).
9. Compliance (role compliance): GET /v1/audit?afterSeq&limit -> {entries, verification (whole chain)}; compliance
   pubkey (X25519) registered by Chloe: POST /v1/compliance/key {publicKey (0x + 32 bytes), issuedAt (unix s, decimal
   string), signature = EIP-191 by her Ledger of `complianceKeyMessage(company, publicKey, issuedAt)`
   (@badge/consent)}; fresh <= 10 min and newer than the current key -> 201 {keyId}. De-anonymisation happens
   client-side (Chloe decrypts with key derived from her Ledger signature); the reveal is logged via
   POST /v1/audit/reveal-notice {seq (a desk.share entry), reason} -> 201 {seq}.

## Storage (node:sqlite, file under BADGE_DATA_DIR)

enrollments, sessions, used_nonces(signer, nonce), tasks, task_excerpts, consent_requests, grants, policies,
policy_uses, revocations, desk_members(commitment, registration order), desk_requests, desk_offers,
nullifiers(scope, nullifier), audit_log (append-only, enforced by triggers), compliance_keys. The directory is not
stored (seed configuration). Migrations as ordered SQL files (src/db/migrations); repositories with typed rows (zod).

## Audit

append-only {seq, ts, type, actor, subject, data(json, never excerpt text — hashes only), prevHash, hash=sha256(prevHash|canonical)}.
verifyChain(). Types: enroll, session.open, task.created, consent.requested, consent.approved, consent.rejected,
grant.reused, policy.created, policy.used, revoke, rule.warn, rule.block, desk.join, desk.request, desk.share,
compliance.key, compliance.reveal. Data shapes are closed per type (src/audit/events.ts).
