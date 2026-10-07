# @badge/zk

Identités anonymes de desk (Semaphore v4) et preuves d'appartenance pour le partage entre desks : le desk
destinataire apprend qu'un membre du desk source partage cet extrait pour cette requête, jamais lequel.

## Flux

1. L'employé signe sur son Ledger (EIP-191) le message `deskIdentityDeriveMessage(entreprise)` de `@badge/consent`.
2. `deriveDeskIdentity(signature)` : la clé Semaphore est `keccak256(signature)` (32 octets). Les signatures Ledger
   sont déterministes (RFC 6979), donc l'identité se re-dérive à la demande et n'est jamais stockée.
3. L'enclave enregistre l'engagement (`identity.commitment`, signé via `DeskJoin`) et construit le groupe du desk
   avec `buildDeskGroup(engagements)` ; la racine (`deskGroupRoot`) est la valeur attendue côté vérification.
4. `createDeskProof({ identity, group, excerptHash, requestId })` : preuve Groth16 (~1 s), profondeur **toujours 16**.
5. `encodeDeskProof` / `decodeDeskProof` : format filaire JSON (grands nombres en chaînes décimales canoniques).
6. `verifyDeskProof(preuve, { expectedRoot, expectedExcerptHash, expectedRequestId }, registre)` : accepte ou lève
   une `ZkError` avec un `code`.

## Règles de vérification

| Contrôle                                 | Code d'erreur                  |
| ---------------------------------------- | ------------------------------ |
| forme de la preuve (schéma zod)          | `MALFORMED_PROOF`              |
| profondeur = 16                          | `WRONG_DEPTH`                  |
| racine = racine du desk attendu          | `WRONG_ROOT`                   |
| message = `excerptHash`, scope = requête | `WRONG_MESSAGE`, `WRONG_SCOPE` |
| preuve Groth16 valide                    | `INVALID_PROOF`                |
| nullifier jamais vu pour cette requête   | `NULLIFIER_REUSED`             |

Le contrôle de racine est indispensable : `verifyProof` seul accepte une preuve valide issue de **n'importe quel**
groupe, y compris celui d'un autre desk. Le nullifier n'est consommé qu'après tous les autres contrôles, pour
qu'une preuve invalide ne puisse pas « brûler » celui d'un membre légitime.

## Message et scope

Semaphore v4 hache lui-même message et scope (`keccak256(valeur sur 32 octets) >> 8`, qui tient dans le corps
BN254) : un `bytes32` est donc passé tel quel, sans réduction, et la preuve transporte la valeur brute. On les passe
toujours en `bigint` : une chaîne non numérique serait encodée silencieusement comme texte `bytes32`.

## Artefacts

`semaphore-16.wasm` et `semaphore-16.zkey` (téléchargés par `infra/setup.sh`, non versionnés). Résolution, au moment
de la preuve et jamais à l'import : argument `artifactsDir`, puis `BADGE_ZK_ARTIFACTS_DIR`, puis
`<racine du repo>/infra/zk-artifacts` trouvée depuis le répertoire courant. Fichiers absents : `ARTIFACTS_MISSING`
(jamais de téléchargement implicite). Dans l'image de l'enclave ou une app Next.js, définir `BADGE_ZK_ARTIFACTS_DIR`.

## Registre des nullifiers

`NullifierRegistry.consume(scope, nullifier)` doit être atomique (contrainte d'unicité ou transaction).
`InMemoryNullifierRegistry` sert aux tests et à la démo mono-processus.

## Tests

```bash
pnpm vitest run --project zk
```
