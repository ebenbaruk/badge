# @badge/enclave

Service confidentiel de Badge, exécuté dans un CVM Intel TDX (Phala dstack) : API HTTP derrière un canal attesté,
moteur de politique (consentements, accords permanents, révocations, règles anti-aspiration), mémoire et LLM,
partage anonyme entre desks et journal de conformité chaîné.

Le contrat de l'API est `docs/enclave-api.md` ; les formes exactes des réponses sont les schémas zod de
`@badge/client` (`api-schemas.ts`), partagés par l'enclave et ses clients.

## Lancer l'enclave en local

```bash
infra/dstack-sim.sh start                  # TEE simulé (hors CVM)
infra/stack.sh up && infra/stack.sh seed   # mémoire Honcho et jeu de données Coinbase
pnpm --filter @badge/enclave start         # ou `dev` (rechargement à chaud) ; écoute sur 127.0.0.1:8787
```

Le jeu de données met en scène Coinbase et son client Morpho : scénario illustratif, sans lien avec Coinbase ni
Morpho.

Au démarrage, l'enclave lit sa mesure auprès de dstack (échec immédiat si l'agent ou le simulateur ne répond pas),
ouvre sa base SQLite, puis journalise une ligne sans
secret : profil LLM (URL et modèles, jamais la clé), mesure, mode TEE (simulé ou CVM), canal exigé ou non, fichier
de données. `SIGINT` / `SIGTERM` arrêtent proprement le serveur.

## Configuration

| Variable                                                              | Rôle                                                                          | Défaut                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| `BADGE_ENCLAVE_PORT`                                                  | port HTTP                                                                     | `8787`                     |
| `BADGE_ENCLAVE_HOST`                                                  | interface d'écoute (`0.0.0.0` dans le CVM, derrière la passerelle)            | `127.0.0.1`                |
| `BADGE_DATA_DIR`                                                      | dossier de `enclave.sqlite`                                                   | `infra/.data/enclave`      |
| `BADGE_SEED_FILE`                                                     | annuaire et notes (jeu de données)                                            | `infra/seed/coinbase.json` |
| `BADGE_REQUIRE_CHANNEL`                                               | `false` autorise le HTTP en clair pour les outils locaux ; refusé dans un CVM | `true`                     |
| `DSTACK_SIMULATOR_ENDPOINT`                                           | simulateur dstack (ignoré dans un CVM, qui utilise `/var/run/dstack.sock`)    | `http://127.0.0.1:8090`    |
| `BADGE_LLM_PROFILE`                                                   | `build` ou `phala` (voir « Couche LLM »)                                      | `build`                    |
| `BADGE_LLM_CHAT_MODEL`                                                | remplace le modèle de chat du profil, sans toucher aux secrets                | modèle du profil           |
| `BADGE_LLM_GATEWAY_URL`                                               | passerelle de sortie du CVM, remplace l'URL du profil                         | aucune                     |
| `BADGE_ENV_FILE`                                                      | fichier des secrets LLM (les variables d'environnement l'emportent)           | `../.env` à côté du dépôt  |
| `BADGE_HONCHO_URL`, `BADGE_HONCHO_JWT_FILE`, `BADGE_HONCHO_WORKSPACE` | mémoire Honcho                                                                | pile locale, `coinbase`    |

Dans le CVM, `infra/cvm/compose.yml` fixe ces variables et l'image (`Dockerfile`) fixe l'hôte, le port et
`BADGE_DATA_DIR=/data` : voir `docs/DEPLOY.md`.

## Architecture

`createEnclaveApp(deps)` (`src/api/app.ts`) monte d'abord la couche sécurité, qui possède le transport et
l'appelant, puis les routes métier, qui ne voient que des requêtes authentifiées. Toutes les dépendances sont
injectées (`AppDeps`) : les tests exécutent la vraie application en mémoire, `src/server.ts` branche les
implémentations réelles et `src/main.ts` lance le processus (`pnpm start` comme l'image Docker).

| Module           | Rôle                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/security`   | Canal attesté, authentification des requêtes (signature de la clé de session, rejeu, horloge), mesure, rotation des clés. |
| `src/db`         | SQLite (`node:sqlite`), migrations SQL ordonnées, transactions, nonces par signataire (consommation atomique).            |
| `src/directory`  | Annuaire chargé depuis le jeu de données (rôles, desks, règles d'échange) et inventaire du contexte.                      |
| `src/audit`      | Journal append-only chaîné (sha256) et `verifyChain`.                                                                     |
| `src/policy`     | Inscription, sessions, consentements, accords, accords permanents, révocations ; règles anti-aspiration.                  |
| `src/tasks`      | Orchestration des tâches : candidats, sélection, décision par extrait, brief et statistiques de jetons.                   |
| `src/desks`      | Adhésion aux desks, demandes entre desks, preuves Semaphore, nullifiers persistants, identité scellée.                    |
| `src/compliance` | Clé de conformité (X25519, signée sur le Ledger), lecture du journal, levée d'anonymat journalisée.                       |
| `src/llm`        | Profil unique compatible OpenAI, client (complétion, sortie structurée, embeddings).                                      |
| `src/memory`     | Mémoire Honcho (candidats sur tous les contextes), classifieur, rédaction du brief.                                       |
| `src/api`        | Application Hono, enveloppe d'erreur unique `{ error: { code, message } }`, routes par domaine.                           |

Principes :

- **Échec fermé** : toute vérification lève une erreur typée avec un `code` en MAJUSCULES_SOULIGNÉES ; un message
  signé n'a d'effet que dans **une transaction** qui consomme son nonce, applique l'effet et écrit l'entrée d'audit.
- **Une seule source de vérité** : l'authentification (`createAuthMiddleware` + `SessionRepository.findActiveCaller`),
  la mesure (`GET /v1/attestation/measurement`, lue une fois auprès de dstack), les messages de la clé de conformité
  et le scellement (`@badge/attest`), les formes filaires (`@badge/client`).
- **Révocation** : `KeyRotator` (versions persistées dans `key_versions`) fait tourner la clé de données du
  propriétaire avant d'enregistrer la révocation ; un brief rédigé avec un extrait révoqué est rédigé à nouveau sans
  lui.
- **Journal** : il ne contient **jamais** de texte d'extrait (empreintes et longueurs uniquement) ; l'identité du
  signataire d'un partage de desk y est scellée pour la seule responsable conformité.

## Sélection du contexte et règles anti-aspiration

Pour une tâche, la mémoire propose des candidats sur le contexte global et sur celui de chaque employé ; le
classifieur LLM juge chacun (pertinence, données personnelles) et une porte déterministe décide
(`src/tasks/selection.ts`) :

- le contexte global et les notes du demandeur n'ont besoin que d'être pertinents ;
- la note d'un collègue doit être nettement pertinente (au moins 0,7), sans donnée personnelle et sans étiquette
  privée (`perso`, `rh`, `confidentiel`) : sinon elle ne part même pas vers son Ledger. Le rappel de congés de Bob,
  qui nomme pourtant le rendez-vous Morpho, n'est donc jamais proposé pour le brief d'Alice.

Règles anti-aspiration (`src/policy/rules.ts`, seuils nommés) : longueur de l'extrait, part du contexte du
propriétaire, nombre de propriétaires par tâche, demandes par propriétaire et par heure. Un agent piégé qui demande
« tout le contexte de Bob » (`requestFullContextOf`) produit au minimum un avertissement montré à Bob, qu'aucun accord
permanent ne couvre ; au-delà du plafond (8 000 caractères), la demande est bloquée avant de lui parvenir.

**Desks** : chaque membre rejoint son desk avec son propre Ledger (`DeskJoin`) ; aucune identité n'est
préenregistrée. Un desk ne peut être sollicité qu'avec au moins 3 membres ainsi inscrits (`MIN_DESK_ANONYMITY_SET`,
sinon `ANONYMITY_SET_TOO_SMALL`) : dans la démo, David et Emma (desk Research, Speculos 5004 et 5005) rejoignent
Research avec leur Ledger (`pnpm demo`, ou `pnpm desks:seed` avant la démo web), puis Bob. La racine du groupe source
est figée à la création de la demande : toutes les preuves de cette demande s'y rapportent.

## Couche LLM (`src/llm`)

- **Un seul profil compatible OpenAI** : URL de base, clé, modèle de chat, modèle d'embeddings (384 dimensions).
  - `build` : variables `BUILD_LLM_*` / `BUILD_EMBEDDING_*` (OpenAI, `text-embedding-3-small` réduit à 384).
  - `phala` : variables `PHALA_AI_*` (Phala Confidential AI, embeddings `sentence-transformers/all-minilm-l6-v2`).
- Choix par `BADGE_LLM_PROFILE` ; secrets lus dans `BADGE_ENV_FILE`, les variables d'environnement l'emportant (le
  conteneur les reçoit directement). `BADGE_LLM_CHAT_MODEL` change de modèle de chat sans toucher aux secrets.
- **Dans le CVM**, `BADGE_LLM_GATEWAY_URL` remplace l'URL du profil par la passerelle de sortie (HTTP sur le réseau
  scellé) : c'est elle qui détient la vraie clé, l'enclave n'a qu'une clé factice.
- `createLlmClient(profile)` : `complete`, `structuredCompletion(schemaZod, messages)` (sortie `json_schema` stricte
  puis validée par zod) et `embed`. Raisonnement désactivé (`reasoning_effort: "none"`).
- La clé n'apparaît jamais dans les journaux ni dans les erreurs (propriété non énumérable, masquage des réponses).

## Couche mémoire (`src/memory`)

- `HonchoMemory` : `ingest` idempotent ; `findCandidates(tâche, { requesterId })` renvoie des extraits candidats
  classés sur le contexte global **et** celui de chaque employé.
- `classifyExcerpt` (pertinence, données personnelles) et `draftBrief` (rédigé **uniquement** à partir des extraits
  autorisés). Notes et tâches sont encadrées comme des données dans les prompts (`fence`).

**Frontière de confiance** : la mémoire lit tous les contextes (clé admin Honcho, dans l'enclave). Ce qu'elle
renvoie n'est qu'une liste de candidats : rien ne sort de l'enclave sans le moteur de politique.

Changer de profil LLM impose `infra/stack.sh reset` puis `up` et `seed` : les embeddings de deux modèles ne sont pas
comparables.

## Image et déploiement

`Dockerfile` (à construire depuis la racine, en `linux/amd64`) : dépendances de production filtrées, sources
TypeScript exécutées par tsx, utilisateur non root, aucun secret. Répétition locale du CVM avec le simulateur
(`infra/cvm/rehearse.sh up`, qui vérifie aussi un aller-retour par le canal attesté à travers la passerelle) et
déploiement sur Phala : `docs/DEPLOY.md`.

## Tests

```bash
pnpm --filter @badge/enclave test        # unitaires, API et test de contrat (BadgeClient contre l'application réelle)
pnpm --filter @badge/enclave test:sim    # canal attesté de bout en bout (infra/dstack-sim.sh start)
pnpm --filter @badge/enclave test:live   # pile locale + profil build (quelques appels payants)
BADGE_LIVE_PHALA=1 pnpm --filter @badge/enclave test:live   # + 2 appels Phala Confidential AI
pnpm demo                                # scénario complet en direct (voir scripts/demo.ts)
```

Les tests de desks et le test de contrat génèrent de vraies preuves Semaphore : artefacts dans `infra/zk-artifacts`
(`infra/setup.sh`) ou `BADGE_ZK_ARTIFACTS_DIR`.
