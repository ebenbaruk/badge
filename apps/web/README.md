# @badge/web

Application des employés et de la conformité (Next.js App Router, React 19, Tailwind v4, shadcn/ui), clair et
sombre, interface en français. Le serveur Next joue deux rôles :

- **pont vers les Ledger** de chaque employé (Speculos Flex) : miroir d'écran, gestes, signatures réelles
  (`@badge/ledger`) vérifiées avec `@badge/consent` avant tout envoi ;
- **runtime d'agent** : transforme la tâche tapée par l'employé en requête à l'enclave, détient la clé de session
  déléguée par `AgentSession` (conservée sur disque, voir plus bas) et l'identité anonyme de desk (en mémoire).

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
(miroir en direct, clic = toucher, appui long = « Hold to sign », glisser à gauche = page suivante ; « Revue auto »
uniquement en répétition, avec `BADGE_REHEARSAL=1`).

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
`AgentSession`) et la mémoire de ses propres demandes (identifiants de tâches et de demandes entre desks), car
l'enclave répond par identifiant, ainsi que l'historique des demandes d'accord tranchées (libellé, demandeur,
décision ; jamais le texte des extraits). Le tout est conservé dans `BADGE_WEB_DATA_DIR/agent-runtime.json`
(`src/server/agent-store.ts`) : fichier `600` dans un dossier `700`, écrit de façon atomique, ignoré par git. Un
redémarrage du serveur ne demande donc aucune nouvelle signature tant que la session n'a pas expiré (8 h). Un
fichier lisible par d'autres utilisateurs ou mal formé est ignoré (avertissement dans le journal) : il faut alors
déléguer à nouveau, ce qui est sûr, plutôt que de faire confiance à une clé peut-être divulguée. L'identité de desk
n'est pas conservée : c'est un secret Semaphore, re-dérivé d'une signature Ledger quand il le faut
(au premier partage anonyme après un redémarrage, sans nouvelle adhésion).

La clé de conformité est lue dans l'enclave (`GET /v1/compliance/key`) : après un redémarrage, l'écran
Configuration de Chloé la montre déjà enregistrée et ne redemande pas de signature.

Levée d'anonymat : le Ledger de Chloé signe le message de dérivation (`complianceKeyDeriveMessage`), la clé X25519
est dérivée **dans le pont**, ouvre l'identité scellée du journal (`openSealed`), est vérifiée contre l'annuaire puis
effacée ; seul l'avis de levée (`POST /v1/audit/reveal-notice`) part vers l'enclave.

## Routes du pont Ledger

- `GET /api/devices/:employé/screen` : capture PNG de l'écran (sondée ~5 fois/s pendant une revue).
- `POST /api/devices/:employé/input` : `{ kind: "tap" | "hold", x, y }` ou `{ kind: "swipe-next" }`
  (coordonnées de l'écran 480 x 600).
- `POST /api/devices/:employé/review` : `{ decision: "approve" | "reject" }`, revue automatique (Speculos), seulement
  avec `BADGE_REHEARSAL=1` (404 sinon).
- Les deux `POST` refusent toute requête inter-sites (CSRF) : `Origin` étranger ou `Sec-Fetch-Site` autre que
  `same-origin` (403), corps autre que `application/json` (415), en-tête `x-badge-device: 1` absent (403).

## Variables d'environnement

| Variable                                   | Défaut                        | Rôle                                                                                             |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `BADGE_ENCLAVE_MODE`                       | `live`                        | `live` (enclave réelle) ou `mock` (développement de l'interface)                                 |
| `BADGE_ENCLAVE_URL`                        | `http://127.0.0.1:8787`       | Origine de l'enclave                                                                             |
| `BADGE_ATTESTATION_MODE`                   | selon l'URL                   | `simulated` (simulateur dstack, enclave en loopback uniquement) ou `tdx` (défaut hors loopback)  |
| `BADGE_ENCLAVE_COMPOSE_HASH`               | —                             | Compose hash épinglé (sinon lu dans le fichier d'épingles)                                       |
| `BADGE_ENCLAVE_APP_ID`                     | —                             | App id dstack épinglé (sinon lu dans le fichier d'épingles)                                      |
| `BADGE_ENCLAVE_OS_MEASUREMENTS_FILE`       | —                             | `infra/cvm/expected-measurements.json` ; en `tdx`, compose hash, app id et mesures OS **requis** |
| `BADGE_REHEARSAL`                          | `0`                           | `1` active la revue automatique sur le Ledger (répétitions seulement)                            |
| `BADGE_SPECULOS_ALICE` / `_BOB` / `_CHLOE` | `http://localhost:5001..5003` | Speculos de chaque employé                                                                       |
| `BADGE_CAL_TEST_KEY`                       | —                             | Clé CAL de test (PEM), **requise** : le bundle Next ne peut pas retrouver le chemin par défaut   |
| `BADGE_ZK_ARTIFACTS_DIR`                   | `<dépôt>/infra/zk-artifacts`  | Artefacts Semaphore profondeur 16                                                                |
| `BADGE_WEB_DATA_DIR`                       | `.data` (dans `apps/web`)     | État conservé du runtime d'agent (clés de session, identifiants de tâches), droits `600`         |
| `BADGE_MOCK_MEASUREMENT`                   | empreinte fixe                | Mesure (bytes32) de l'enclave simulée                                                            |

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
- Un onglet masqué (`document.hidden`, y compris une fenêtre simplement recouverte sur macOS) ralentit le miroir
  (une image toutes les 5 s hors revue) et le rafraîchissement automatique (10 s) sans les arrêter ; au retour sur
  l'onglet, la page se rafraîchit aussitôt. Chrome peut encore espacer ces minuteries dans un onglet masqué.
