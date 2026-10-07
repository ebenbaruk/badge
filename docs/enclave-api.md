# Contrat de l'enclave (apps/enclave)

> Spécification de référence de l'API de l'enclave Badge, partagée par l'enclave, l'application web, le serveur MCP
> et le script de démo. Rédigée en anglais. Les formes exactes des réponses sont les schémas zod de
> `packages/client/src/api-schemas.ts` : le SDK valide chaque réponse avec eux et l'enclave type ses réponses avec
> les mêmes types ; `apps/enclave/test/contract.test.ts` vérifie les deux bouts ensemble sur tout le scénario.

## Actors

- **Directory** (seeded by the administrator from `infra/seed/acme.json`, loaded at boot, immutable while running):
  employees `{id, name, team, role: employee | compliance, address, desks[]}` of the company "Acme".
  Alice (Ventes, desk Origination), Bob (Grands comptes, desk Research), Chloe (Juridique & conformite, compliance),
  David and Emma (Strategie, desk Research). Ledger addresses (Speculos test mnemonics, `infra/speculos.sh`): alice
  `0x9858EfFD232B4033E47d90003D41EC34EcaEda94`, bob `0x58A57ed9d8d624cBD12e2C467D34787555bB1b25`, chloe
  `0x3061750d3dF69ef7B8d4407CB7f3F879Fd9d2398`, david `0xfc2077CA7F403cBECA41B1B0F62D91B5EA631B5E`, emma
  `0xc70eC8094CCE52B6574A5a2b7bf0c7D8288d77cC`. Every desk member joins with their own Ledger (`DeskJoin`): no desk
  identity is pre-registered, and a desk can be asked only once it has `MIN_DESK_ANONYMITY_SET` (3) joined members
  (Semaphore warns that groups of 1-2 are not anonymous). `pnpm demo` joins David and Emma; before the web demo,
  `pnpm desks:seed` does.
  Exchange rules `{id, label (device ASCII, shown on the Ledger), sourceDesk, recipientDesk, allowedTags[]}`; demo:
  `rule-4` "Regle 4 - marche capteurs", research -> origination, tags `marche-capteurs`, `prix-composants`.
- **Employees** sign EIP-712 messages on their Ledger (`packages/consent`, clear signing) and two EIP-191 personal
  messages (desk identity, compliance key).
- **Agents** act with an agent session key (secp256k1, software), delegated once by an `AgentSession` signed on the
  Ledger. The session's employee is the caller of every request the key signs.

## Transport and authentication

Layering (`apps/enclave/src/api/app.ts`): the security layer (`src/security`) is mounted first and owns the transport
and the caller; domain routes registered after it only see authenticated requests.

- **Attested channel** (`packages/attest`, wire format in `packages/client/src/channel-wire.ts`):
  `POST /v1/channel/open {nonce, clientPk} -> {channelId, enclavePk, bundle}` (TDX quote over
  `sha512(nonce || clientPk || enclavePk)`, event log, app-compose); `POST /v1/channel/:id {sealed} -> {sealed}`.
  The inner payload `{method, path, headers, body} -> {status, contentType, body}` is dispatched in-process to the
  same app. Inner paths must be under `/v1/` (no `..`, never the channel itself); forwarded headers: `content-type`
  and the three `x-badge-*` headers; the path must be identical once URL-normalised (no encoded dot segment).
  Channels live in memory (idle TTL 15 min, 30 s for a channel that never carried a message; cap 10 000: when full,
  the oldest never-used channel is dropped first, `503 CHANNEL_CAPACITY` only when all are in use);
  an unknown or expired id answers `404 CHANNEL_UNKNOWN` (the SDK reopens and retries once: the request was not
  executed); reusing a hello answers `409 CHANNEL_EXISTS`.
- **Channel required**: with `BADGE_REQUIRE_CHANNEL=true` (default, forced inside a CVM: TLS ends at the Phala
  gateway) any `/v1` call not dispatched by the channel answers `403 CHANNEL_REQUIRED`, except the channel routes and
  the measurement. `BADGE_REQUIRE_CHANNEL=false` allows plain HTTP for local tools.
- **Request signature**: every `/v1` route except the public ones carries `x-badge-session` (session key address),
  `x-badge-ts` (unix ms) and `x-badge-sig` = EIP-191 signature by the session key of
  `BADGE-REQ-V1\n{METHOD}\n{path+query}\n{ts}\n{sha256(body) lowercase hex}` (`canonicalRequest`,
  `packages/client/src/request-auth.ts`; verified by `src/security/auth.ts`). Refusals (401): `AUTH_MISSING`,
  `AUTH_MALFORMED`, `CLOCK_SKEW` (more than 60 s), `BAD_SIGNATURE`, `SESSION_UNKNOWN` (unknown, expired or revoked
  session, resolved by `SessionRepository.findActiveCaller` BEFORE any replay slot is taken), `REPLAY` (cache keyed
  on session + signed string, not on the malleable signature bytes, kept 1 ms beyond the skew window; full cache
  fails closed with `503 REPLAY_CACHE_FULL`). Bodies above 256 KiB: 413.
- **Public routes**: `GET /health`, `GET /v1/attestation/measurement`, `POST /v1/channel/*`, and the two routes whose
  bodies are Ledger-signed: `POST /v1/enroll`, `POST /v1/sessions`. Any new route is authenticated by default.
- In code, the middleware sets `c.var.caller: Caller {employeeId, address (Ledger), sessionKey}` (Hono env
  `BadgeEnv`, `src/security/types.ts`).

## Enclave measurement

`GET /v1/attestation/measurement -> {measurement, composeHash, appId}`: the deployment's compose hash read from the
dstack guest agent (the simulator locally, the real CVM on Phala; inside a CVM the simulator is never used), and its
bytes32 form, equal to `AttestationResult.enclaveMeasurement` of the channel. Every signed message carries it; a
mismatch is refused (`ENCLAVE_MISMATCH`).

## Errors

Single envelope `{ "error": { "code", "message" } }`, with a stable machine `code` in UPPER_SNAKE_CASE (the same
convention everywhere: enclave, `@badge/client` (`NETWORK_ERROR`, `BAD_RESPONSE`, `ATTESTATION_FAILED`,
`CHANNEL_FAILED`, `NO_SESSION_KEY`, `INVALID_ARGUMENT`, produced by the SDK itself), `@badge/attest`, `@badge/consent`,
`@badge/zk`):

- security layer: `AUTH_*`, `CLOCK_SKEW`, `BAD_SIGNATURE`, `REPLAY`, `SESSION_UNKNOWN` 401,
  `CHANNEL_REQUIRED` 403, `CHANNEL_UNKNOWN` 404, `CHANNEL_EXISTS` 409, `BODY_TOO_LARGE` 413, `INVALID_BODY` /
  `CHANNEL_REJECTED` 400, `REPLAY_CACHE_FULL` / `CHANNEL_CAPACITY` / `DSTACK_FAILED` 503;
- domain: `INVALID_REQUEST` 400, `FORBIDDEN` / `UNKNOWN_EMPLOYEE` / `NOT_ENROLLED` 403, `NOT_FOUND` 404,
  `NONCE_REUSED` / `ALREADY_EXISTS` / `NOT_PENDING` / `COMPLIANCE_KEY_MISSING` / `ANONYMITY_SET_TOO_SMALL` 409,
  `SESSION_TOO_LONG` / `STALE` /
  `NO_RULE` 422, `UPSTREAM_FAILED` 502 (memory or LLM; never echoes their output), `INTERNAL` 500 (details only in
  the enclave log);
- `@badge/consent`: `INVALID_MESSAGE` / `NOT_DEVICE_ASCII` / `SIGNATURE_MALFORMED` 400, `SIGNATURE_MISMATCH` 403,
  `EXPIRED` / `ENCLAVE_MISMATCH` / `EXCERPT_HASH_MISMATCH`... 422;
- `@badge/zk`: `MALFORMED_PROOF` 400, `WRONG_ROOT` / `WRONG_MESSAGE` / `WRONG_SCOPE` / `INVALID_PROOF` 422,
  `NULLIFIER_REUSED` 409.

Another employee's resource is reported as `NOT_FOUND`. Signed messages travel as the `@badge/consent` wire envelope
`{kind, message, signature}` (bigints as decimal strings). Times outside signed messages are unix seconds.

## Flows

1. **Enrollment** `POST /v1/enroll` (signed `EmployeeEnroll`, no session yet): signed by the directory address;
   company, employeeName and team equal to the directory (device ASCII); `issuedAt` at most 10 min old; nonce unused.
   `201 {employee}`.
2. **Agent session** `POST /v1/sessions` (signed `AgentSession`): employee enrolled; `expiresAt` at most 12 h ahead;
   the session key is not a directory Ledger address; the same employee may re-delegate a key whose session ended.
   `201 {sessionKey, employeeId, agentName, expiresAt}`. `GET /v1/me` returns the caller's directory profile and `contextTags`, the sorted tags of their own notes (what a
   standing agreement can cover).
3. **Task** `POST /v1/tasks {task (<= 2000 chars), taskLabel, requestFullContextOf?}` by the requester's agent:
   - memory finds candidates across the company context and every personal context; the LLM classifier keeps the
     relevant ones;
   - `requestFullContextOf` (what a prompt-injected agent does): one excerpt made of all of that owner's notes,
     labelled "Tout le contexte de <name>", not filtered by relevance but subject to the same rules and consent;
   - company context and the requester's own notes are allowed;
   - another owner's excerpt: the mass-extraction rules first (block = refused, never reaches the owner); then an
     active grant of this exact excerpt (`grant_reused`); then, if the rules are `ok`, a matching active standing
     policy (team of the requester == `granteeTeam`, `contextTag` among the excerpt tags, length <= max: `policy`,
     logged as `policy.used`); otherwise a pending consent with the exact `ContextShare` prepared by the enclave
     (`recipientName` "Alice Martin (Ventes)", `excerptLabel` cut from the excerpt (<= 60 ASCII chars), length,
     `taskLabel`, `expiresAt` = now + 24 h, `excerptHash`, measurement, recipient, owner, taskId, random nonce);
   - an owner without a Ledger can never consent: their excerpts are blocked (`OWNER_CANNOT_CONSENT`).
     Mass-extraction rules (named thresholds, `src/policy/rules.ts`): excerpt length (warn > 600, block > 8000), share
     of the owner's whole context requested by the task (warn >= 90 %), distinct owners in one task (warn >= 3,
     block > 6), requests per owner per hour (warn >= 20, block >= 60), explicit full-context request (warn). A warning
     is shown to the owner and logged (`rule.warn`); a standing policy never covers a warned request.
     `201 Task` (same as `GET /v1/tasks/:id` below; the brief is drafted at once when nothing is pending).
4. **Task status** `GET /v1/tasks/:id` (requester only): `allowed[]` (`via`: `company | own | consent |
grant_reused | policy`), `pending[]` (with `consentId` and `risk {level, reasons[{code, severity, message}]}`),
   `blocked[]` (with `risk`), `refused[]` (`reason`: `rejected | expired | revoked`). Until an excerpt is released to
   the requester its label reads "Contexte personnel de <name>"; its text never appears. Once nothing is pending,
   `brief` is drafted inside the enclave from the excerpts still covered (a revoked grant or policy moves its excerpt
   to `refused` and the cached brief is redrafted without it), with `tokenStats {selectedTokens, allContextTokens}`
   (o200k_base).
5. **Consents** `GET /v1/consents` (caller = owner): pending `ContextShare` requests `{id, taskId, requester, excerpt
{label, length, text, tags}, message (to sign), risk, createdAt}` and pending `DeskShare` requests (below);
   requests whose message expired are retired first. `POST /v1/consents/:id/approve {signature}`: the owner's
   signature of the prepared message, checked against the stored excerpt text; nonce consumed; grant stored (id =
   `hashBadgeMessage`) -> `{consentId, status: "approved", grantId}`. `POST /v1/consents/:id/reject` ->
   `{consentId, status: "rejected", grantId: null}`. `GET /v1/grants`: the caller's active one-off grants.
6. **Revocation**, prepared by the enclave like a `ContextShare`, because the device only shows `targetLabel` and
   the date (`grantId` and `recipient` are signed but hidden):
   - `POST /v1/revocations/prepare {grantId} | {recipient: employeeId}` (owner's agent) -> `{message}`: the exact
     `ContextRevoke` to sign, whose `targetLabel` names the real scope (`revocationTargetLabel`, `@badge/consent`):
     a grant `"<recipientName> - <excerptLabel>"` (recipient = the grant's), a policy
     `"Accord equipe <team> - <tag>"` (recipient = `0x0`), everything for a colleague
     `"Tout ce que j'ai partage avec <name> + accords equipe <team>"` (grantId = `0x0`).
   - `POST /v1/revocations` (signed `ContextRevoke`, owner's own agent): `grantId` = one of the owner's grants or
     policies, or `0x0` = every grant to `recipient` (a directory address) and the policies granted to their team.
     A label or recipient other than the canonical ones of that target is refused (`INVALID_REQUEST`). The owner's
     data key is rotated (`KeyRotator.rotate`, version persisted) before the revocation is recorded.
     `201 {revocationId, revokedGrants, revokedPolicies}`; later tasks need fresh consent.
7. **Standing agreements** `POST /v1/policies` (signed `ContextPolicy`, owner's own agent; `granteeTeam` must be a
   directory team in device ASCII) -> `201 Policy {id, granteeTeam, contextTag, purpose, maxExcerptLength, expiresAt,
createdAt, status: active | revoked | expired, uses}`; `GET /v1/policies` lists the caller's policies.
8. **Desks** (API ids `research`, `origination`; names in signed messages "Research", "Origination"):
   - `POST /v1/desks/join` (signed `DeskJoin` by the caller's Ledger; the caller is a member of the desk in the
     directory) -> `201 Desk {id, name, members, commitments[] (decimal, registration order), root | null}`;
     `GET /v1/desks/:desk` -> `Desk` (what a member needs to build a proof).
   - `POST /v1/desk-requests {fromDesk, task, ruleId?}` (requester is a member of `fromDesk`): refused with
     `ANONYMITY_SET_TOO_SMALL` while the source desk has fewer than 3 Ledger-joined members. The exchange rule whose
     recipient is `fromDesk` (`ruleId` needed only if several apply) selects, per member of the source desk who joined
     it, the best candidate excerpt whose tags intersect the rule's tags, and prepares one `DeskShare` per owner. The
     source desk's root is snapshotted (`sourceRoot`): every share of the request proves against it ->
     `201 DeskRequest {id, status: waiting_share | delivered | no_match | declined | expired, ruleId, ruleLabel,
fromDesk, sourceDesk, sourceRoot, deliveries[], createdAt}` (`expired`: left unanswered past the DeskShare expiry).
   - The asked owner sees `{kind: "DeskShare", id (= desk request id), recipientDesk, sourceDesk, ruleLabel, excerpt,
message}` in `GET /v1/consents`, then `POST /v1/desk-requests/:id/approve {signature, proof}`: DeskShare signed by
     the caller's Ledger (member of the source desk), checked against the stored text; a compliance key must be
     registered (else `COMPLIANCE_KEY_MISSING`); nonce unused; Semaphore proof with root = the request's
     `sourceRoot`, message = `excerptHash`, scope = request id; the delivery, the nonce, the nullifier (fresh, else
     `NULLIFIER_REUSED`) and the audit entry commit in one transaction -> `{requestId, status: "delivered"}`. The audit
     entry `desk.share` has actor `anonymous` and the signer identity sealed to the compliance key. Expired offers are
     no longer listed in `GET /v1/consents`.
     `POST /v1/desk-requests/:id/reject` -> `{requestId, status: "rejected"}`.
   - `GET /v1/desk-requests/:id` (requester only): `deliveries[{excerpt, excerptHash, proof}]`, ordered by excerpt
     hash, never naming the owner. The requester verifies each delivery itself: `hashExcerpt(excerpt) ===
excerptHash`, and the proof (`checkDeskProof`) against the request's `sourceRoot`, never the desk's current root.
9. **Compliance** (role `compliance` only):
   - Key: Chloe signs (EIP-191, Ledger) `complianceKeyDeriveMessage("Acme")`; X25519 secret = keccak256(signature),
     never sent (Ledger signatures are deterministic: the same Ledger re-derives the same key). Registration:
     `POST /v1/compliance/key {publicKey (hex), signature}` where `signature` is her EIP-191 signature of
     `complianceKeyRegistrationMessage("Acme", publicKey)` (all three in `packages/attest`) ->
     `201 {keyId, employeeId, publicKey, registeredAt}`. Registering the current key again is a no-op; a replaced key
     can never become current again (`STALE`). `GET /v1/compliance/key -> {key: ComplianceKey | null}` tells her
     client whether a registration is still needed (no Ledger review when the enclave already holds the key).
   - `GET /v1/audit?afterSeq&limit` -> `{entries[], chain {valid, length, brokenAt}}` (the chain verification covers
     the whole log, the entries are a page of at most 500).
   - De-anonymisation happens on the officer's side: she opens `data.sealedSigner` of a `desk.share` entry with her
     Ledger-derived key (`openSealed`), then logs it with `POST /v1/audit/reveal-notice {seq, reason}` -> `201`
     the new `compliance.reveal` audit entry.

## Storage

SQLite (`node:sqlite`), one file `enclave.sqlite` under `BADGE_DATA_DIR`, ordered SQL migrations
(`src/db/migrations`), typed rows (zod). Tables: enrollments, sessions, used_nonces (signer, nonce), tasks,
task_excerpts, consent_requests, grants, policies, policy_uses, revocations, key_versions, desk_members (registration
order), desk_requests, desk_offers, nullifiers (scope, nullifier), audit_log (append-only, enforced by triggers),
compliance_keys. The directory is configuration, not storage. A signed message only takes effect in one transaction
that consumes its nonce, applies the effect and appends the audit entry.

## Audit

Append-only `{seq, ts, type, actor, subject, data, prevHash, hash = sha256(prevHash | canonical entry)}`;
`verifyChain()` checks the whole chain. `data` shapes are closed per type (`src/audit/events.ts`) and never contain
excerpt text, only hashes, lengths and ids. Types: `enroll`, `session.open`, `task.created`, `consent.requested`,
`consent.approved`, `consent.rejected`, `grant.reused`, `policy.created`, `policy.used`, `revoke`, `rule.warn`,
`rule.block`, `desk.join`, `desk.request`, `desk.share`, `compliance.key`, `compliance.reveal`.

## Keys

- Channel key: X25519 derived from the dstack KMS (`badge/channel/x25519`).
- Per-employee data key: dstack `getKey("badge/dek/{employeeId}:{version}")`, version persisted in `key_versions`
  (starts at 1). A revocation rotates it (`version + 1`); old versions stay derivable to read old data.
- Desk-share signer identity in the audit: `sealToPublicKey(compliancePublicKey, json)` (X25519 sealed box,
  `packages/attest`).

## Wire shapes (v1)

| Route                              | Body                                           | Response (`api-schemas.ts`)                     |
| ---------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| GET /v1/attestation/measurement    |                                                | `Measurement {measurement, composeHash, appId}` |
| POST /v1/enroll                    | signed EmployeeEnroll                          | `{employee: Employee}`                          |
| POST /v1/sessions                  | signed AgentSession                            | `Session`                                       |
| GET /v1/me                         |                                                | `Me` (Employee + company + contextTags)         |
| POST /v1/tasks                     | `{task, taskLabel, requestFullContextOf?}`     | `Task`                                          |
| GET /v1/tasks/:id                  |                                                | `Task`                                          |
| GET /v1/consents                   |                                                | `{consents: (ContextShare or DeskShare)[]}`     |
| POST /v1/consents/:id/approve      | `{signature}`                                  | `ConsentDecision`                               |
| POST /v1/consents/:id/reject       | `{}`                                           | `ConsentDecision`                               |
| GET /v1/grants                     |                                                | `{grants: Grant[]}`                             |
| POST /v1/revocations/prepare       | `{grantId}` or `{recipient}`                   | `PreparedRevocation {message}`                  |
| POST /v1/revocations               | signed ContextRevoke                           | `RevocationResult`                              |
| POST /v1/policies                  | signed ContextPolicy                           | `Policy`                                        |
| GET /v1/policies                   |                                                | `{policies: Policy[]}`                          |
| POST /v1/desks/join                | signed DeskJoin                                | `Desk`                                          |
| GET /v1/desks/:desk                |                                                | `Desk`                                          |
| POST /v1/desk-requests             | `{fromDesk, task, ruleId?}`                    | `DeskRequest`                                   |
| GET /v1/desk-requests/:id          |                                                | `DeskRequest`                                   |
| POST /v1/desk-requests/:id/approve | `{signature, proof}` (proof: `@badge/zk` wire) | `DeskShareDecision`                             |
| POST /v1/desk-requests/:id/reject  | `{}`                                           | `DeskShareDecision`                             |
| GET /v1/compliance/key             |                                                | `{key: ComplianceKey or null}`                  |
| POST /v1/compliance/key            | `{publicKey, signature}`                       | `ComplianceKey`                                 |
| GET /v1/audit                      | query `afterSeq`, `limit`                      | `AuditLog`                                      |
| POST /v1/audit/reveal-notice       | `{seq, reason}`                                | `AuditEntry`                                    |
