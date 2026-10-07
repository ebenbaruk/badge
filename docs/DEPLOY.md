# Déploiement sur Phala Cloud (CVM Intel TDX)

Ce document décrit comment empaqueter Badge, le déployer dans un CVM Phala (dstack, Intel TDX), épingler ses
mesures côté client, puis tout arrêter. **Le CVM est facturé de `phala-up.sh` jusqu'à `phala-down.sh`.**

## Ce qui tourne dans le CVM

`infra/cvm/compose.yml` est le code attesté : son compose hash (sha256 de l'`app-compose` qui l'embarque) est la
mesure que les clients épinglent et que chaque accord signé sur le Ledger porte (`enclaveMeasurement`).

| Service        | Image                                      | Réseaux          | Rôle                                                                        |
| -------------- | ------------------------------------------ | ---------------- | --------------------------------------------------------------------------- |
| `secrets-init` | `ghcr.io/ebenbaruk/badge-honcho@sha256:…`  | aucun            | Au premier démarrage : secret JWT Honcho, mot de passe Postgres, JWT admin. |
| `database`     | `pgvector/pgvector:pg15@sha256:…`          | `sealed`         | Mémoire Honcho (pgvector, 384 dimensions).                                  |
| `api`          | `ghcr.io/ebenbaruk/badge-honcho@sha256:…`  | `sealed`         | API Honcho 3.2.2 (auth JWT obligatoire).                                    |
| `deriver`      | `ghcr.io/ebenbaruk/badge-honcho@sha256:…`  | `sealed`         | Dérivation de la mémoire (LLM via la passerelle).                           |
| `enclave`      | `ghcr.io/ebenbaruk/badge-enclave@sha256:…` | `sealed`         | API Badge (port 8787), socket dstack monté, données dans le volume `/data`. |
| `seed`         | `ghcr.io/ebenbaruk/badge-enclave@sha256:…` | `sealed`         | Tâche unique : ingère `infra/seed/acme.json` et vérifie le rappel.          |
| `gateway`      | `ghcr.io/ebenbaruk/badge-gateway@sha256:…` | `sealed`, egress | Seule sortie (2 routes LLM, clé injectée) et seule entrée (8787 → enclave). |

- **Réseau scellé** : `sealed` est un réseau Docker interne (pas de route ni de DNS externe). Seule la passerelle
  sort, et uniquement vers `/chat/completions` et `/embeddings` de Phala Confidential AI, en TLS vérifié ; elle
  injecte la vraie clé, Honcho et l'enclave n'ont qu'une clé factice (`BADGE_LLM_GATEWAY_URL`).
- **Un seul port publié** : 8787, servi par la passerelle et routé vers l'enclave. URL publique :
  `https://<app-id>-8787.<cluster>.phala.network` (TLS terminé par la passerelle dstack ; la confidentialité
  jusqu'à l'enclave vient du canal attesté `POST /v1/channel/*`).
- **Secrets** : seules trois variables sont transmises, chiffrées sur la machine de l'opérateur vers la clé KMS
  du CVM (seuls leurs **noms** entrent dans le compose hash) :

  | Variable                   | Contenu                                                    |
  | -------------------------- | ---------------------------------------------------------- |
  | `PHALA_AI_API_KEY`         | clé Confidential AI (reçue uniquement par la passerelle)   |
  | `PHALA_AI_MODEL`           | modèle de chat (ex. `qwen/qwen3.6-27b`)                    |
  | `PHALA_AI_EMBEDDING_MODEL` | défaut `sentence-transformers/all-minilm-l6-v2` (384 dim.) |

  Aucune URL parmi elles : la valeur d'une variable chiffrée reste au choix de l'opérateur hors du compose hash.
  L'hôte LLM (`https://inference.phala.com/v1`) est donc un littéral de `compose.yml` **et** figé dans l'image de la
  passerelle (`infra/gateway/15-badge-upstream.envsh`), qui s'arrête si on lui en donne un autre ; les clients
  refusent une app-compose dont `allowed_envs` contient un point de terminaison (`*_URL`, `*_HOST`...).

  Le secret JWT Honcho, le mot de passe Postgres et le JWT admin de l'enclave sont **générés dans le CVM** au
  premier démarrage (`infra/honcho/secrets-init.sh`) et ne le quittent jamais : personne, pas même l'opérateur,
  ne les connaît. Ils vivent sur le disque chiffré du CVM et disparaissent avec lui.

- **Images publiques** sur `ghcr.io/ebenbaruk` : le CVM les tire sans identifiants (aucun secret de registre à lui
  confier) et elles ne contiennent aucun secret ; n'importe qui peut les tirer et comparer leurs digests à ceux du
  compose. Toutes les images sont référencées **par digest** : une étiquette pourrait désigner un autre code demain
  sans changer le hash.

## Prérequis

- Docker avec `buildx` (les images sont toujours construites en `linux/amd64`, même sur un Mac Apple Silicon).
- CLI `phala` 1.1.22, `jq`, `curl`, `pnpm` ; `pnpm install` fait.
- Fichier de secrets (`BADGE_ENV_FILE`, défaut `../.env` à côté du dépôt) avec `PHALA_AI_*` et
  `PHALA_CLOUD_API_KEY` (lu par les scripts et passé à la CLI par variable d'environnement, jamais en argument).
- Pour publier : `docker login ghcr.io` avec un jeton GitHub `write:packages`, puis rendre les trois paquets
  publics une fois dans GitHub.

## Étapes

### 1. Construire les images (local, gratuit)

```bash
infra/cvm/build-push.sh build
```

Construit `badge-enclave:cvm-amd64` (`apps/enclave/Dockerfile`), `badge-gateway:cvm-amd64` (`infra/gateway`) et
`badge/honcho:3.2.2-amd64` (`infra/stack.sh build`), et vérifie qu'elles sont bien `amd64`.

### 2. Répétition locale du CVM (gratuit)

```bash
infra/dstack-sim.sh start
infra/cvm/rehearse.sh up      # démarre le compose du CVM avec les images locales et le simulateur dstack
infra/cvm/rehearse.sh down    # arrêt et suppression des volumes de répétition
```

Vérifie : génération des secrets, Postgres et Honcho sains, enclave saine **à travers la passerelle**
(`http://127.0.0.1:18787/health`), mesure exposée, canal attesté ouvert et aller-retour d'une requête par ce canal
(`infra/cvm/check-channel.ts` : quote vérifié contre le simulateur, mesure relue dans le canal identique à la mesure
attestée), HTTP en clair refusé sur `/v1` (`CHANNEL_REQUIRED`), aucun autre port publié, Honcho sans route vers Internet. La
clé LLM est factice : aucun appel n'est facturé (le seed n'est donc pas lancé).

### 3. Publier et épingler les digests

```bash
infra/cvm/build-push.sh push   # refuse un arbre git modifié (BADGE_ALLOW_DIRTY=1 pour forcer)
git diff infra/cvm/compose.yml # seuls les digests changent
git commit -m "chore(cvm): digests des images" infra/cvm/compose.yml
```

### 4. Déployer (payant)

```bash
PHALA_CONFIRM_SPEND=yes infra/phala-up.sh
```

Le script :

1. refuse les digests factices, les images non épinglées, un `compose.yml` non commité et un CVM `badge` déjà
   existant (pas de double facturation) ;
2. écrit les quatre variables `PHALA_AI_*` dans un fichier temporaire (droits 600, supprimé aussitôt) ;
3. lance `phala deploy --kms phala --no-dev-os --no-public-logs --no-public-sysinfo --public-tcbinfo --no-listed`,
   instance `tdx.medium`, disque `20G`, et attend la fin ;
4. récupère l'attestation (`phala cvms attestation --json`) et écrit les épingles avec
   `infra/cvm/pin-measurements.ts` (voir plus bas) ;
5. affiche l'app id et l'URL, attend `/health`, et vérifie que la mesure annoncée par l'enclave est le compose hash
   épinglé.

Si une étape échoue **après** le déploiement, le script le dit : le CVM tourne et coûte, lancer `phala-down.sh`.

Le service `seed` ingère ensuite le jeu de démonstration (quelques minutes de dérivation par le LLM confidentiel).

### 5. Surveiller, puis tout arrêter

```bash
infra/phala-status.sh   # lecture seule : compte, CVM existants, conteneurs, santé, mesure vs épingle
infra/phala-down.sh     # stop PUIS delete : plus rien n'est facturé
```

Un CVM seulement arrêté paie encore son disque : `phala-down.sh` le supprime toujours. La suppression efface la
mémoire, la base de l'enclave et les secrets internes ; un nouveau déploiement a un nouvel app id, donc de nouvelles
épingles.

## Coûts (tarifs `phala instance-types`, 7 octobre 2026)

| Instance       | vCPU | Mémoire | Prix/heure | 8 h de démo | 24 h   |
| -------------- | ---- | ------- | ---------- | ----------- | ------ |
| `tdx.small`    | 1    | 2 Go    | 0,058 $    | 0,46 $      | 1,39 $ |
| **tdx.medium** | 2    | 4 Go    | 0,116 $    | 0,93 $      | 2,78 $ |
| `tdx.large`    | 4    | 8 Go    | 0,232 $    | 1,86 $      | 5,57 $ |

- **`tdx.medium` par défaut** (`BADGE_PHALA_INSTANCE_TYPE` pour changer) : la pile occupe environ 0,9 Go au repos
  (Postgres 120 Mo, API et deriver Honcho 270 Mo chacun, enclave ~150 Mo, nginx) en plus de l'OS dstack et de
  Docker ; 2 Go ne laissent pas de marge pour le tirage des images et les pics du deriver.
- Disque 20 Go (`BADGE_PHALA_DISK_SIZE`) : stockage à environ 0,000139 $/Go/h, négligeable.
- LLM : chaque appel à Phala Confidential AI est facturé à part (seed initial : une dérivation par note, puis
  quelques appels de vérification à chaque redémarrage).
- Règle : allumer pour une session, `phala-down.sh` juste après ; `phala-status.sh` liste tout CVM oublié.

## Épinglage côté client

`phala-up.sh` écrit deux fichiers, à commiter (valeurs publiques) :

- `infra/cvm/expected-compose-hash.txt` : le compose hash (hex) ;
- `infra/cvm/expected-measurements.json` : `composeHash`, `appId` et `osMeasurements` (`mrtd`, `rtmr0`-`rtmr2`).

`pin-measurements.ts` (fonction `captureDeploymentPins` de `@badge/attest`) n'écrit rien si le déploiement n'est pas
exactement le nôtre : l'event log doit se rejouer sur les RTMR annoncés, l'événement `compose-hash` doit valoir
sha256(`app_compose`), le `docker_compose_file` embarqué doit être **octet pour octet** `infra/cvm/compose.yml`, et
`public_logs` / `public_sysinfo` doivent être à `false` avec le KMS actif. C'est une confiance au premier usage de
l'opérateur sur les données de la plateforme ; la preuve matérielle est vérifiée par chaque client, à chaque canal.

Le client (SDK `@badge/client`) épingle le compose hash, l'app id, les mesures de l'OS et le KMS :

```ts
import { readFileSync } from "node:fs";
import { BadgeClient, enclavePinsFromEnv } from "@badge/client";

const pins = enclavePinsFromEnv(
  { BADGE_ENCLAVE_OS_MEASUREMENTS_FILE: "infra/cvm/expected-measurements.json" },
  "tdx",
  (path) => readFileSync(path, "utf8"),
);
const client = new BadgeClient({
  baseUrl: "https://<app-id>-8787.<cluster>.phala.network",
  transport: "channel", // canal attesté : seul accepté par l'enclave en production
  attestationMode: "tdx", // signature Intel DCAP + TCB à jour, rejeu des RTMR, politique de l'app-compose
  ...pins,
  sessionKey,
});
```

En mode `tdx`, compose hash, app id (`expectedAppId`) et mesures de l'OS (`expectedOsMeasurements`) sont
obligatoires (échec fermé) : ils excluent la même compose déployée sur une image OS de développement (accès root
à l'invité) ou sous un autre app id / KMS. L'application web et le serveur MCP les lisent depuis
`BADGE_ENCLAVE_OS_MEASUREMENTS_FILE` (et `BADGE_ENCLAVE_COMPOSE_HASH`, `BADGE_ENCLAVE_APP_ID` s'ils sont donnés,
qui doivent concorder). Les accords signés sur le Ledger portent `enclaveMeasurement = 0x<compose hash>` : un accord signé pour
une autre version du code est refusé (`ENCLAVE_MISMATCH`).

Toute modification de `infra/cvm/compose.yml` (même un commentaire), d'un digest d'image ou de la liste des
variables chiffrées change le compose hash : redéployer, puis redistribuer les épingles.

## Profil LLM Phala et re-seed

- **Dans le CVM**, le profil est toujours `phala` (fixé dans `compose.yml`) : Honcho et l'enclave passent par la
  passerelle vers l'hôte épinglé `https://inference.phala.com/v1`, embeddings MiniLM 384 dimensions.
- **Re-seed dans le CVM** : le service `seed` tourne à chaque démarrage et est idempotent (notes déjà présentes
  ignorées). Pour repartir de zéro (autre modèle d'embeddings, jeu modifié) : `phala-down.sh` puis
  `phala-up.sh` (nouveau disque, nouvelle mémoire). Changer `PHALA_AI_MODEL` n'impose pas de reset ; changer
  `PHALA_AI_EMBEDDING_MODEL` l'impose (deux modèles d'embeddings ne sont pas comparables).
- **En local**, pour répéter la démo avec le LLM confidentiel :

  ```bash
  infra/stack.sh reset                       # efface la mémoire indexée avec le profil build
  BADGE_LLM_PROFILE=phala infra/stack.sh up
  BADGE_LLM_PROFILE=phala infra/stack.sh seed
  BADGE_LLM_PROFILE=phala pnpm --filter @badge/enclave start
  ```

  `stack.sh` refuse de mélanger deux profils sur la même mémoire (marqueur `infra/.data/indexed-profile`).

## Limites connues

- **Journaux** : avec `--no-public-logs`, les journaux des conteneurs ne sont pas publiés ; le seed ne peut pas lire
  ceux du deriver (`BADGE_SEED_DERIVER_LOGS=skip`), seuls ses contrôles de représentation et de rappel s'appliquent.
  `phala ps` peut être refusé avec `--no-public-sysinfo` ; `phala-status.sh` s'appuie alors sur `/health`.
- **Socket dstack** : l'enclave tourne sous l'utilisateur `node` (uid 1000). Si le socket `/var/run/dstack.sock` du
  CVM n'est pas accessible à cet uid, l'enclave refuse de démarrer (erreur `DSTACK_FAILED`) ; correctif : ajouter
  `user: "0"` au service `enclave` (ce qui change le compose hash).
- Le format JSON exact de `phala deploy --json` et `phala cvms get --json` n'est pas documenté : les scripts
  cherchent `app_id` et l'URL publique dans toute la réponse ; en cas d'échec, les sorties brutes sont dans
  `infra/.data/cvm/`.
