# @badge/enclave

Service confidentiel de Badge, exécuté dans l'enclave (Phala dstack) : API HTTP, moteur de politique, journal de
conformité, partage anonyme entre desks, couches LLM et mémoire. Le contrat de l'API est `docs/enclave-api.md`.

## Domaine et API

| Module           | Rôle                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/db`         | SQLite (`node:sqlite`), migrations SQL ordonnées, transactions, nonces par signataire (consommation atomique).                  |
| `src/directory`  | Annuaire chargé depuis `infra/seed/acme.json` (rôles, desks, règles d'échange) et inventaire du contexte.                       |
| `src/audit`      | Journal append-only chaîné (sha256), `verifyChain`, interface `Sealer` (scellement pour la conformité).                         |
| `src/policy`     | Moteur de politique (inscription, sessions, consentements, accords, accords permanents, révocations) et règles anti-aspiration. |
| `src/tasks`      | Orchestration des tâches : candidats, classification, décision par extrait, brief et statistiques de jetons.                    |
| `src/desks`      | Adhésion aux desks, demandes entre desks, preuves Semaphore, registre de nullifiers persistant.                                 |
| `src/compliance` | Clé de conformité (X25519, signée EIP-191), lecture du journal, notification de levée d'anonymat.                               |
| `src/api`        | Application Hono pure (`createApp(deps)`), enveloppe d'erreur unique, middleware d'authentification injecté.                    |
| `src/server.ts`  | Câblage réel (SQLite, Honcho, profil LLM, mesure dstack) et `startEnclaveServer(sécurité)`, port 8787.                          |
| `src/main.ts`    | Point d'entrée du processus (`pnpm --filter @badge/enclave start`, image Docker) : assemble la sécurité et gère SIGTERM.        |

Principes : **échec fermé** (toute vérification lève une erreur typée avec un `code`), un message signé n'a d'effet
que dans **une transaction** qui consomme son nonce, applique l'effet et écrit l'entrée d'audit ; le journal ne
contient **jamais** de texte d'extrait (empreintes et longueurs uniquement).

Règles anti-aspiration (`src/policy/rules.ts`, seuils nommés) : longueur de l'extrait, part du contexte du
propriétaire, nombre de propriétaires par tâche, demandes par propriétaire et par heure. Un agent piégé qui demande
« tout le contexte de Bob » (`requestFullContextOf`) produit au minimum un avertissement montré à Bob ; au-delà du
plafond (8 000 caractères), la demande est bloquée avant de lui parvenir.

**Données de démonstration** : David et Emma (desk Research) n'ont pas de Ledger ; leurs identités de desk sont
dérivées d'une graine publique du jeu de données et enregistrées au démarrage, pour que le groupe Research compte au
moins 3 membres. Elles ne peuvent rien signer.

### Ce que l'intégrateur fournit

`startEnclaveServer(fabriqueSécurité)` reçoit `{ db, clock, dstack, config }` et attend :

- `authenticate` : middleware Hono qui vérifie la signature de session et fait `c.set("caller", …)` (types dans
  `src/security/types.ts`) ; la session se résout avec `new SessionRepository(db).findActiveCaller(clé, maintenant)`.
- `keyRotator` : `rotateOwnerKey(employeeId)`, appelé à chaque révocation.
- `sealer` : `seal(cléPublique, octets)`, scellement X25519 de `@badge/attest`.

Variables : `BADGE_DATA_DIR` (défaut `infra/.data/enclave`), `BADGE_ENCLAVE_PORT` (8787), `BADGE_ENCLAVE_HOST`
(127.0.0.1), `BADGE_SEED_FILE`, `DSTACK_SIMULATOR_ENDPOINT` (hors CVM ; défaut `http://127.0.0.1:8090`).

## Image et déploiement

`apps/enclave/Dockerfile` (à construire depuis la racine, en `linux/amd64`) : dépendances de production filtrées,
sources TypeScript exécutées par tsx, utilisateur non root, aucun secret. Déploiement dans le CVM Phala :
`docs/DEPLOY.md`.

## Couche LLM (`src/llm`)

- **Un seul « profil » compatible OpenAI** : URL de base, clé, modèle de chat, modèle d'embeddings (384 dimensions).
  - `build` : variables `BUILD_LLM_*` / `BUILD_EMBEDDING_*` (OpenAI, `text-embedding-3-small` réduit à 384).
  - `phala` : variables `PHALA_AI_*` (Phala Confidential AI, embeddings `sentence-transformers/all-minilm-l6-v2`).
  - Dans le CVM, `BADGE_LLM_GATEWAY_URL` remplace l'URL du profil par la passerelle de sortie (HTTP sur le
    réseau scellé) : c'est elle qui détient la vraie clé.
  - Choix par `BADGE_LLM_PROFILE=build|phala` ; secrets lus dans `BADGE_ENV_FILE` (défaut : `../.env` à côté du
    dépôt) ; `BADGE_LLM_CHAT_MODEL` remplace le modèle de chat sans toucher aux secrets.
- `createLlmClient(profile)` : `complete`, `structuredCompletion(schemaZod, messages)` (sortie `json_schema`
  stricte puis validée par zod) et `embed`. Raisonnement désactivé (`reasoning_effort: "none"`).
- La clé n'apparaît jamais dans les journaux ni dans les erreurs (propriété non énumérable, masquage des réponses).

## Couche mémoire (`src/memory`)

- `HonchoMemory` (interface `MemoryStore`) :
  - `ingest({ ownerId | "company", text, tags })` : idempotent (identifiant de note stable).
  - `findCandidates(tâche, { requesterId })` : extraits candidats classés (`ownerId`, `scope`, `text`, `source`,
    `score`) sur le contexte global **et** celui de chaque employé.
- `classifyExcerpt(llm, tâche, extrait)` : pertinence, présence de données personnelles, justification.
- `draftBrief(llm, tâche, extraitsAutorisés)` : rédige le brief **uniquement** à partir des extraits fournis.

**Frontière de confiance** : la mémoire lit tous les contextes (clé admin Honcho, dans l'enclave). Ce qu'elle
renvoie n'est qu'une liste de candidats : rien ne sort de l'enclave sans le moteur de politique (accord signé sur
le Ledger du propriétaire pour tout extrait personnel d'un tiers).

## Couche sécurité (`src/security`)

À monter **avant** les routes métier (Hono applique les middlewares dans l'ordre d'enregistrement) :

```ts
const app = new Hono<BadgeEnv>();
const security = mountSecurityRoutes(app, {
  dstack: createDstackClient(), // socket dstack dans le CVM, DSTACK_SIMULATOR_ENDPOINT en local
  sessions, // SessionResolver du domaine : clé de session -> Caller, null si inconnue, expirée ou révoquée
  clock: systemClock,
  requireChannel: true, // production : tout /v1 passe par le canal attesté
});
// puis les routes métier ; c.var.caller est défini sur toute route authentifiée.
```

- **Authentification** (`createAuthMiddleware`) : signature EIP-191 de la clé de session sur la requête canonique
  (`@badge/client`), écart d'horloge ≤ 60 s, cache anti-rejeu borné (clé = session + chaîne signée, insensible à la
  malléabilité ECDSA ; plein = refus 503 plutôt qu'oubli). Routes publiques : `isPublicRoute` ; toute nouvelle
  route `/v1` est protégée par défaut.
- **Canal attesté** : `POST /v1/channel/open`, `POST /v1/channel/:id` (requête interne rejouée en mémoire via
  `app.request`, réponse scellée), table en mémoire avec TTL d'inactivité et plafond ; un même `hello` ne peut pas
  rouvrir un canal (il remettrait les numéros de séquence à zéro).
- **Mesure** : `GET /v1/attestation/measurement` ; `security.identity.read()` donne la même valeur au domaine.
- **Clés** : `KeyRotator` (interface `DekProvider`) dérive la DEK de chaque employé via le KMS dstack
  (`badge/dek/{id}:{version}`) ; `rotate(id)` incrémente la version, persistée par un `KeyVersionStore` du domaine.
- Erreurs : `{ error: { code, message } }` (`SecurityError`).

## Pile locale

```bash
export BADGE_ENV_FILE=/chemin/vers/.env   # si le fichier n'est pas à côté du dépôt
infra/stack.sh up      # construit les images au besoin, démarre Postgres, Honcho, le deriver et la passerelle
infra/stack.sh seed    # ingère infra/seed/acme.json, attend le deriver, vérifie le rappel
infra/stack.sh logs deriver
infra/stack.sh down    # arrêt (données conservées) ; reset = arrêt + suppression de la mémoire
```

Changer de profil LLM impose `reset` puis `up` et `seed` : les embeddings de deux modèles ne sont pas comparables.

## Tests

```bash
pnpm --filter @badge/enclave test        # unitaires et API en mémoire, sans réseau (test/desks : artefacts ZK)
pnpm --filter @badge/enclave test        # unitaires, sans réseau
pnpm --filter @badge/enclave test:sim    # couche sécurité + SDK de bout en bout (infra/dstack-sim.sh start)
pnpm --filter @badge/enclave test:live   # pile locale + profil build (quelques appels payants)
BADGE_LIVE_PHALA=1 pnpm --filter @badge/enclave test:live   # + 2 appels Phala Confidential AI
```
