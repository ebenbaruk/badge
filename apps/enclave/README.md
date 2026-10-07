# @badge/enclave

Service confidentiel de Badge, exécuté dans l'enclave (Phala dstack). Ce dossier contient pour l'instant la couche
LLM et la couche mémoire ; l'API HTTP, le moteur de politique, le journal de conformité et le stockage viendront
s'y ajouter.

## Couche LLM (`src/llm`)

- **Un seul « profil » compatible OpenAI** : URL de base, clé, modèle de chat, modèle d'embeddings (384 dimensions).
  - `build` : variables `BUILD_LLM_*` / `BUILD_EMBEDDING_*` (OpenAI, `text-embedding-3-small` réduit à 384).
  - `phala` : variables `PHALA_AI_*` (Phala Confidential AI, embeddings `sentence-transformers/all-minilm-l6-v2`).
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
pnpm --filter @badge/enclave test        # unitaires, sans réseau
pnpm --filter @badge/enclave test:live   # pile locale + profil build (quelques appels payants)
BADGE_LIVE_PHALA=1 pnpm --filter @badge/enclave test:live   # + 2 appels Phala Confidential AI
```
