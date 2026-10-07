# @badge/web

Application des employés et de la conformité (Next.js App Router, React 19, Tailwind v4, shadcn/ui), clair et
sombre, interface en français. Le serveur Next joue deux rôles :

- **pont vers les Ledger** de chaque employé (Speculos Flex) : miroir d'écran, gestes, signatures réelles
  (`@badge/ledger`) vérifiées avec `@badge/consent` avant tout envoi ;
- **runtime d'agent** : transforme la tâche tapée par l'employé en requête à l'enclave, détient la clé de session
  déléguée par `AgentSession` et l'identité anonyme de desk (en mémoire uniquement).

## Écrans (`/[employé]/…`)

| Route        | Contenu                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `agent`      | Tâche, étapes dans l'enclave, attente d'accord, brief avec sources et provenance, compteur de tokens, agent compromis |
| `consents`   | Demandes reçues, alertes des règles en rouge, aperçu exact de l'écran du Ledger, « Approuver sur mon Ledger »         |
| `agreements` | Accords permanents (`ContextPolicy`) : création signée, usages, révocation                                            |
| `access`     | Accès actifs, révocation signée (`ContextRevoke`) d'un accord ou de tout ce qui est partagé avec un collègue          |
| `desks`      | Adhésion anonyme (`DeskJoin` + dérivation), demandes entre desks, partage avec preuve ZK                              |
| `compliance` | Chloé uniquement : journal chaîné et sa vérification, alertes, identités scellées, « Lever l'anonymat »               |
| `onboarding` | `EmployeeEnroll`, `AgentSession` (8 h) et, pour la conformité, l'enregistrement de la clé dérivée du Ledger           |

Barre du haut : changement d'employé (démo), badge d'attestation (vert « Enclave attestée » pour une quote TDX
vérifiée, ambre « TEE simulé » sinon) avec la mesure de l'enclave. Panneau de droite : le Ledger de l'employé
(miroir en direct, clic = toucher, appui long = « Hold to sign », glisser à gauche = page suivante, « Revue auto »
pour les répétitions).

## Enclave : `src/server/enclave`

`enclave()` renvoie un `EnclaveApi` (vues dans `types.ts`) selon `BADGE_ENCLAVE_MODE` :

- `live` (défaut) : `live.ts`, l'enclave réelle via `@badge/client`, **canal attesté** obligatoire. La quote est
  vérifiée avant tout échange (`simulated` en local contre le simulateur dstack, `tdx` en production avec le compose
  hash épinglé). Le badge du haut est vert seulement pour une quote TDX vérifiée, ambre « TEE simulé » sinon ; sa
  fenêtre de détails montre la mesure (compose hash) signée dans chaque message Ledger. `live-views.ts` traduit les
  réponses de l'enclave en vues : niveaux de risque, raisons et statuts sont **ceux de l'enclave**, jamais recalculés.
- `mock` : enclave fictive en mémoire (`src/server/mock`) sur `infra/seed/acme.json`, **pour le développement de
  l'interface uniquement** (sans enclave, mémoire ni LLM). Signatures Ledger et preuves ZK y restent réelles.

Le serveur Next est le **runtime d'agent** de chaque employé : une clé de session par employé (déléguée par
`AgentSession`, en mémoire seulement), et la mémoire de ses propres demandes (identifiants de tâches et de demandes
entre desks), car l'enclave répond par identifiant. Un redémarrage du serveur oblige donc à rouvrir les sessions
(Configuration) ; l'inscription est idempotente côté enclave.

Levée d'anonymat : le Ledger de Chloé signe le message de dérivation (`complianceKeyDeriveMessage`), la clé X25519
est dérivée **dans le pont**, ouvre l'identité scellée du journal (`openSealed`), est vérifiée contre l'annuaire puis
effacée ; seul l'avis de levée (`POST /v1/audit/reveal-notice`) part vers l'enclave.

## Routes du pont Ledger

- `GET /api/devices/:employé/screen` : capture PNG de l'écran (sondée ~5 fois/s pendant une revue).
- `POST /api/devices/:employé/input` : `{ kind: "tap" | "hold", x, y }` ou `{ kind: "swipe-next" }`
  (coordonnées de l'écran 480 x 600).
- `POST /api/devices/:employé/review` : `{ decision: "approve" | "reject" }`, revue automatique (Speculos).

## Variables d'environnement

| Variable                                   | Défaut                        | Rôle                                                                                           |
| ------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `BADGE_ENCLAVE_MODE`                       | `live`                        | `live` (enclave réelle) ou `mock` (développement de l'interface)                               |
| `BADGE_ENCLAVE_URL`                        | `http://127.0.0.1:8787`       | Origine de l'enclave                                                                           |
| `BADGE_ATTESTATION_MODE`                   | `simulated`                   | `simulated` (simulateur dstack) ou `tdx` (CVM Phala)                                           |
| `BADGE_ENCLAVE_COMPOSE_HASH`               | —                             | Compose hash épinglé, **requis** en `tdx`                                                      |
| `BADGE_SPECULOS_ALICE` / `_BOB` / `_CHLOE` | `http://localhost:5001..5003` | Speculos de chaque employé                                                                     |
| `BADGE_CAL_TEST_KEY`                       | —                             | Clé CAL de test (PEM), **requise** : le bundle Next ne peut pas retrouver le chemin par défaut |
| `BADGE_ZK_ARTIFACTS_DIR`                   | `<dépôt>/infra/zk-artifacts`  | Artefacts Semaphore profondeur 16                                                              |
| `BADGE_MOCK_MEASUREMENT`                   | empreinte fixe                | Mesure (bytes32) de l'enclave simulée                                                          |

## Scripts

```bash
infra/dstack-sim.sh start && infra/stack.sh up      # TEE simulé et mémoire
pnpm --filter @badge/enclave start                  # enclave sur :8787
BADGE_CAL_TEST_KEY=$PWD/infra/keys/cal-test.pem pnpm --filter @badge/web dev   # http://localhost:3000
BADGE_ENCLAVE_MODE=mock pnpm --filter @badge/web dev  # interface seule, enclave fictive
pnpm --filter @badge/web build
pnpm --filter @badge/web typecheck
pnpm vitest run --project web       # vues de l'enclave réelle, helpers, scénario complet sur l'enclave fictive
```

Le scénario de test signe avec les mnémoniques **publiques** de test des Speculos (mêmes adresses que la démo).

## Pièges

- Le DMK Ledger doit être **bundlé** par Next (son build ESM fait des imports de dossier refusés par Node) ;
  seuls `@semaphore-protocol/core` et `snarkjs` sont externes.
- Un onglet en arrière-plan suspend le miroir et le rafraîchissement automatique (`document.hidden`).
