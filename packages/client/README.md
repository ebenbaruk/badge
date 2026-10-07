# @badge/client

SDK typé de l'API de l'enclave Badge, partagé par l'application web, le serveur MCP et le script de démo.
Compatible navigateur et Node. C'est aussi la référence du format filaire HTTP (signature des requêtes, charges du
canal, formes des réponses), que l'enclave importe pour que les deux bouts ne divergent jamais
(voir `docs/enclave-api.md`).

## Utilisation

```ts
import { BadgeClient, createAgentSession } from "@badge/client";

// 1. Canal attesté, sans clé de session : enrôlement et ouverture de session (messages signés sur le Ledger).
const anonymous = new BadgeClient({ baseUrl, transport: "channel", attestationMode: "simulated" });
const attestation = await anonymous.connect(); // AttestationResult : badge « TEE vérifié / simulé » de l'UI
const { message, sessionKey } = createAgentSession(aliceLedgerAddress, {
  agentName: "Claude Code",
  enclaveMeasurement: attestation.enclaveMeasurement,
});
const signature = await ledger.signBadgeMessage("AgentSession", message); // LedgerSigner (@badge/ledger)
await anonymous.openSession({ kind: "AgentSession", message, signature });

// 2. Client de l'agent : chaque appel est signé par la clé de session.
const agent = new BadgeClient({ baseUrl, transport: "channel", attestationMode: "simulated", sessionKey });
const task = await agent.createTask({ task: "Preparer le rendez-vous Durand", taskLabel: "Brief Durand" });
```

- `transport: "channel"` : canal chiffré attesté (`@badge/attest`), ouvert à la demande ; aucune clé n'est dérivée
  avant la vérification du quote. Les requêtes sont sérialisées (numéros de séquence stricts). Un canal expiré est
  rouvert et la requête rejouée une seule fois (code `CHANNEL_UNKNOWN` : la requête n'a pas été exécutée).
- `transport: "plain"` : HTTP direct, pour le développement local (refusé par une enclave en `requireChannel`).
- `attestationMode: "tdx"` exige `expectedComposeHash`.
- Toutes les erreurs sont des `BadgeApiError { status, code, message }` (`code` de l'enclave ou du SDK :
  `NETWORK_ERROR`, `BAD_RESPONSE`, `ATTESTATION_FAILED`, `CHANNEL_FAILED`, `NO_SESSION_KEY`, `INVALID_ARGUMENT`).
- Chaque réponse est validée par zod (`api-schemas.ts`) ; les messages signés qu'elle contient sont décodés avec
  `@badge/consent` (bigint restaurés), prêts à être signés sur le Ledger.

## Signature des requêtes

En-têtes `x-badge-session`, `x-badge-ts` (ms Unix), `x-badge-sig` = signature EIP-191 par la clé de session de
`BADGE-REQ-V1\n{METHODE}\n{chemin+requete}\n{ts}\n{sha256(corps) hex}` (`canonicalRequest`). Horodatages strictement
croissants par client : deux appels identiques dans la même milliseconde ne sont pas pris pour un rejeu.

## Tests

```sh
pnpm vitest run --project client          # unitaires (fetch simulé)
pnpm --filter @badge/enclave test:sim     # bout en bout avec l'enclave et le simulateur dstack
```
