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
- Every API call (except /health, /v1/attestation, /v1/channel/*) is authenticated by a session-key signature:
  headers x-badge-session (address), x-badge-ts (unix ms), x-badge-sig = personal_sign(keccak256(method|path|ts|sha256(body))).
  Reject ts skew > 60 s, replay (ts+sig cache), unknown/expired/revoked session. Session's employee = the caller.
- Attested encrypted channel (packages/attest): POST /v1/channel/open {nonce, clientPk} -> {channelId, enclavePk, bundle};
  POST /v1/channel/:id {sealed} -> {sealed}; inner payload {method, path, headers, body} dispatched to the same Hono app
  in-process (app.request). Plain HTTP routes also exist for local dev; production config can require the channel.

## Enclave measurement

- = compose hash from dstack info() as bytes32 (simulator locally, real CVM on Phala). Exposed by GET /v1/attestation/measurement.
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
