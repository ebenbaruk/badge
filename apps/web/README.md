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
| `access`     | Accès actifs et révoqués, révocation signée (`ContextRevoke`)                                                         |
| `desks`      | Adhésion anonyme (`DeskJoin` + dérivation), demandes entre desks, partage avec preuve ZK                              |
| `compliance` | Chloé uniquement : journal chaîné et sa vérification, alertes, identités scellées, « Lever l'anonymat »               |
| `onboarding` | `EmployeeEnroll` puis `AgentSession` (12 h)                                                                           |

Barre du haut : changement d'employé (démo), badge d'attestation (vert « Enclave attestée » pour une quote TDX
vérifiée, ambre « TEE simulé » sinon) avec la mesure de l'enclave. Panneau de droite : le Ledger de l'employé
(miroir en direct, clic = toucher, appui long = « Hold to sign », glisser à gauche = page suivante, « Revue auto »
pour les répétitions).

## Enclave : `src/server/enclave`

`enclave()` renvoie un `EnclaveApi` (types dans `types.ts`, calqués sur `docs/enclave-api.md`) selon
`BADGE_ENCLAVE_MODE` :

- `mock` (défaut) : enclave en mémoire sur `infra/seed/acme.json` (`src/server/mock`). Elle applique les mêmes
  contrôles que le contrat : signatures, contrôles de `@badge/consent`, nonces, règles anti-aspiration, preuves
  Semaphore réelles, journal chaîné SHA-256. **Les signatures Ledger et les preuves ZK sont réelles même en mock.**
- `live` : `src/server/enclave/live.ts`, chaque méthode rejette `NotWiredError` en attendant `@badge/client`
  (l'interface à brancher est `EnclaveApi`, la clé de session est `agentSessionAccount(employé)`).

## Routes du pont Ledger

- `GET /api/devices/:employé/screen` : capture PNG de l'écran (sondée ~5 fois/s pendant une revue).
- `POST /api/devices/:employé/input` : `{ kind: "tap" | "hold", x, y }` ou `{ kind: "swipe-next" }`
  (coordonnées de l'écran 480 x 600).
- `POST /api/devices/:employé/review` : `{ decision: "approve" | "reject" }`, revue automatique (Speculos).

## Variables d'environnement

| Variable                                   | Défaut                        | Rôle                                                                                           |
| ------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `BADGE_ENCLAVE_MODE`                       | `mock`                        | `mock` ou `live`                                                                               |
| `BADGE_SPECULOS_ALICE` / `_BOB` / `_CHLOE` | `http://localhost:5001..5003` | Speculos de chaque employé                                                                     |
| `BADGE_CAL_TEST_KEY`                       | —                             | Clé CAL de test (PEM), **requise** : le bundle Next ne peut pas retrouver le chemin par défaut |
| `BADGE_ZK_ARTIFACTS_DIR`                   | `<dépôt>/infra/zk-artifacts`  | Artefacts Semaphore profondeur 16                                                              |
| `BADGE_MOCK_MEASUREMENT`                   | empreinte fixe                | Mesure (bytes32) de l'enclave simulée                                                          |

## Scripts

```bash
pnpm --filter @badge/web dev        # http://localhost:3000
pnpm --filter @badge/web build
pnpm --filter @badge/web typecheck
pnpm vitest run --project web       # helpers + scénario complet sur l'enclave simulée
```

Le scénario de test signe avec les mnémoniques **publiques** de test des Speculos (mêmes adresses que la démo).

## Pièges

- Le DMK Ledger doit être **bundlé** par Next (son build ESM fait des imports de dossier refusés par Node) ;
  seuls `@semaphore-protocol/core` et `snarkjs` sont externes.
- Un onglet en arrière-plan suspend le miroir et le rafraîchissement automatique (`document.hidden`).
