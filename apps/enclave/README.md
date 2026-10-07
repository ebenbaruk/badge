# @badge/enclave

Service confidentiel de Badge, exécuté dans l'enclave (Phala dstack) : API HTTP, canal attesté, moteur de politique,
journal de conformité, partage anonyme entre desks, couches LLM et mémoire. Le contrat de l'API est
`docs/enclave-api.md` ; les formes des réponses sont les schémas de `@badge/client` (`api-schemas.ts`).

## Lancer l'enclave

```bash
infra/dstack-sim.sh start          # TEE simulé (hors CVM)
infra/stack.sh up && infra/stack.sh seed   # mémoire Honcho et jeu de données Acme
pnpm --filter @badge/enclave start # ou `dev` (rechargement à chaud) ; écoute sur 127.0.0.1:8787
```

Au démarrage, l'enclave lit sa mesure auprès de dstack (échec immédiat si l'agent ou le simulateur ne répond pas),
ouvre sa base SQLite, enregistre les identités de démonstration du desk Research, puis journalise une ligne sans
secret : profil LLM (URL et modèles, jamais la clé), mesure, mode TEE (simulé ou CVM), canal exigé ou non, fichier
de données. `SIGINT` / `SIGTERM` arrêtent proprement le serveur.

| Variable                                                              | Rôle                                                                         | Défaut                    |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------- |
| `BADGE_ENCLAVE_PORT`                                                  | port HTTP                                                                    | `8787`                    |
| `BADGE_ENCLAVE_HOST`                                                  | interface d'écoute (`0.0.0.0` dans le CVM, derrière la passerelle dstack)    | `127.0.0.1`               |
| `BADGE_DATA_DIR`                                                      | dossier de `enclave.sqlite`                                                  | `infra/.data/enclave`     |
| `BADGE_SEED_FILE`                                                     | annuaire et notes (jeu de données)                                           | `infra/seed/acme.json`    |
| `BADGE_REQUIRE_CHANNEL`                                               | `false` autorise le HTTP en clair pour les outils locaux ; forcé dans un CVM | `true`                    |
| `DSTACK_SIMULATOR_ENDPOINT`                                           | simulateur dstack (ignoré dans un CVM, qui utilise `/var/run/dstack.sock`)   | `http://127.0.0.1:8090`   |
| `BADGE_LLM_PROFILE`                                                   | `build` ou `phala` (voir « Couche LLM »)                                     | `build`                   |
| `BADGE_ENV_FILE`                                                      | fichier des secrets LLM                                                      | `../.env` à côté du dépôt |
| `BADGE_HONCHO_URL`, `BADGE_HONCHO_JWT_FILE`, `BADGE_HONCHO_WORKSPACE` | mémoire Honcho                                                               | pile locale, `acme`       |

## Architecture

`createEnclaveApp(deps)` (`src/api/app.ts`) monte d'abord la couche sécurité, puis les routes métier. Toutes les
dépendances sont injectées (`AppDeps`) : les tests exécutent la vraie application en mémoire, `src/server.ts` branche
les implémentations réelles et `src/main.ts` lance le processus.

| Module           | Rôle                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/security`   | Canal attesté, authentification des requêtes (signature de la clé de session, rejeu, horloge), mesure, rotation des clés. |
| `src/db`         | SQLite (`node:sqlite`), migrations SQL ordonnées, transactions, nonces par signataire (consommation atomique).            |
| `src/directory`  | Annuaire chargé depuis le jeu de données (rôles, desks, règles d'échange) et inventaire du contexte.                      |
| `src/audit`      | Journal append-only chaîné (sha256) et `verifyChain`.                                                                     |
| `src/policy`     | Inscription, sessions, consentements, accords, accords permanents, révocations ; règles anti-aspiration.                  |
| `src/tasks`      | Orchestration des tâches : candidats, classification, décision par extrait, brief et statistiques de jetons.              |
| `src/desks`      | Adhésion aux desks, demandes entre desks, preuves Semaphore, nullifiers persistants, identité scellée.                    |
| `src/compliance` | Clé de conformité (X25519, signée sur le Ledger), lecture du journal, levée d'anonymat journalisée.                       |
| `src/llm`        | Profil unique compatible OpenAI, client (complétion, sortie structurée, embeddings).                                      |
| `src/memory`     | Mémoire Honcho (candidats sur tous les contextes), classifieur, rédaction du brief.                                       |

Principes :

- **Échec fermé** : toute vérification lève une erreur typée avec un `code` ; un message signé n'a d'effet que dans
  **une transaction** qui consomme son nonce, applique l'effet et écrit l'entrée d'audit.
- **Une seule source de vérité** : l'authentification (`createAuthMiddleware` + `SessionRepository.findActiveCaller`),
  la mesure (`GET /v1/attestation/measurement`, lue une fois auprès de dstack), les messages de la clé de conformité
  et le scellement (`@badge/attest`), les formes filaires (`@badge/client`).
- **Révocation** : `KeyRotator` (versions persistées dans `key_versions`) fait tourner la clé de données du
  propriétaire avant d'enregistrer la révocation ; un brief rédigé avec un extrait révoqué est rédigé à nouveau sans lui.
- Le journal ne contient **jamais** de texte d'extrait (empreintes et longueurs uniquement) ; l'identité du
  signataire d'un partage de desk y est scellée pour la seule responsable conformité.

Règles anti-aspiration (`src/policy/rules.ts`, seuils nommés) : longueur de l'extrait, part du contexte du
propriétaire, nombre de propriétaires par tâche, demandes par propriétaire et par heure. Un agent piégé qui demande
« tout le contexte de Bob » (`requestFullContextOf`) produit au minimum un avertissement montré à Bob, qu'aucun accord
permanent ne couvre ; au-delà du plafond (8 000 caractères), la demande est bloquée avant de lui parvenir.

**Données de démonstration** : David et Emma (desk Research) n'ont pas de Ledger ; leurs identités de desk sont
dérivées d'une graine publique du jeu de données et enregistrées au démarrage, pour que le groupe Research compte au
moins 3 membres. Elles ne peuvent rien signer et leur contexte ne peut jamais être partagé.

## Couche LLM (`src/llm`)

- **Un seul « profil » compatible OpenAI** : URL de base, clé, modèle de chat, modèle d'embeddings (384 dimensions).
  - `build` : variables `BUILD_LLM_*` / `BUILD_EMBEDDING_*` (OpenAI, `text-embedding-3-small` réduit à 384).
  - `phala` : variables `PHALA_AI_*` (Phala Confidential AI, embeddings `sentence-transformers/all-minilm-l6-v2`).
  - `BADGE_LLM_CHAT_MODEL` remplace le modèle de chat sans toucher aux secrets.
- `createLlmClient(profile)` : `complete`, `structuredCompletion(schemaZod, messages)` (sortie `json_schema`
  stricte puis validée par zod) et `embed`. Raisonnement désactivé (`reasoning_effort: "none"`).
- La clé n'apparaît jamais dans les journaux ni dans les erreurs (propriété non énumérable, masquage des réponses).

## Couche mémoire (`src/memory`)

- `HonchoMemory` : `ingest` idempotent ; `findCandidates(tâche, { requesterId })` renvoie des extraits candidats
  classés sur le contexte global **et** celui de chaque employé.
- `classifyExcerpt` (pertinence, données personnelles) et `draftBrief` (rédigé **uniquement** à partir des extraits
  autorisés).

**Frontière de confiance** : la mémoire lit tous les contextes (clé admin Honcho, dans l'enclave). Ce qu'elle
renvoie n'est qu'une liste de candidats : rien ne sort de l'enclave sans le moteur de politique.

Changer de profil LLM impose `infra/stack.sh reset` puis `up` et `seed` : les embeddings de deux modèles ne sont pas
comparables.

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
