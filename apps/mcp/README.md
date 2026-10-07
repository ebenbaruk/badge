# @badge/mcp

Serveur MCP qui branche Badge sur la « harness » d'agent de chaque employé (Claude Code, Cursor…). Il agit pour
**un seul employé**, avec la clé de session que cet employé a déléguée à son agent en signant un `AgentSession` sur
son Ledger, et parle à l'enclave par le canal attesté de `@badge/client`.

## Outils

| Outil                    | Entrée              | Ce que l'agent obtient                                                                                                                                                                                                   |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `badge_get_context`      | `{task, taskLabel}` | Crée une tâche ; renvoie le brief rédigé dans l'enclave et la provenance de chaque extrait, ou la liste des accords en attente (« en attente de l'accord de Bob Durand sur son Ledger ») avec l'identifiant de la tâche. |
| `badge_task_status`      | `{taskId}`          | Statut de la tâche ; brief et provenance dès que plus rien n'est en attente.                                                                                                                                             |
| `badge_list_my_consents` | aucune              | Demandes de partage adressées à l'employé (demandeur, extrait, tâche, risque). L'agent ne peut pas les approuver : l'employé signe sur son Ledger.                                                                       |
| `badge_attestation`      | aucune              | Mesure de l'enclave et résumé de l'attestation (TDX vérifiée ou simulée, compose hash, TCB), comparés à la mesure signée dans la session.                                                                                |

Les descriptions sont rédigées pour un LLM, en français et en anglais. Les refus de l'enclave (session inconnue,
règles anti-aspiration…) reviennent comme erreurs d'outil lisibles, pas comme pannes du protocole.

## Garanties

- **Rien d'autre que ce que l'enclave a remis** : le texte d'un collègue n'apparaît que dans un brief rédigé par
  l'enclave à partir d'extraits libérés (accord signé, accord permanent). Le brief est encadré
  (`<<<BADGE_CONTEXT … BADGE_CONTEXT>>>`) et signalé comme données, pas instructions.
- **Échec fermé au démarrage** : en mode `tdx`, le serveur refuse de démarrer si l'attestation échoue (enclave
  injoignable comprise) ; dans tous les modes, une attestation rejetée ou une mesure différente de celle signée dans
  l'`AgentSession` l'empêche de démarrer. Le transport `plain` (sans attestation) n'est accepté qu'avec le simulateur.
- **Clé de session** : lue dans un fichier en `600` (refusé s'il est lisible par d'autres), jamais journalisée ni
  affichée. Elle ne donne que le droit de _demander_ du contexte : chaque partage reste signé sur le Ledger du
  propriétaire.
- **Mode HTTP** : écoute uniquement sur `127.0.0.1`, protection contre le DNS rebinding (en-tête `Host`) et refus de
  toute requête portant un en-tête `Origin` (une page web ne peut pas piloter la session de l'agent).

## Mise en place (une fois par employé et par agent)

1. Créer la clé de session et le message à signer (l'enclave est attestée pour y lire sa mesure) :

   ```sh
   BADGE_ATTESTATION_MODE=simulated pnpm --filter @badge/mcp session create \
     --employee 0x9858EfFD232B4033E47d90003D41EC34EcaEda94 --out ~/.badge/alice-claude.json --agent "Claude Code"
   ```

   Le fichier (droits `600`) contient la clé privée et l'`AgentSession` ; la commande affiche le message (format
   filaire `@badge/consent`) et son empreinte EIP-712. Durée : 8 h par défaut, 12 h au plus (`--ttl-hours`).

2. Faire signer l'`AgentSession` sur le Ledger de l'employé et ouvrir la session dans l'enclave :

   ```sh
   # signature obtenue ailleurs (application web, @badge/ledger) :
   pnpm --filter @badge/mcp session open --file ~/.badge/alice-claude.json --signature 0x…
   # ou directement sur un Speculos (validation à l'écran de l'appareil) :
   pnpm --filter @badge/mcp session open --file ~/.badge/alice-claude.json --ledger http://localhost:5001
   ```

   La signature est vérifiée localement (elle doit venir de l'adresse de l'employé) avant l'envoi. Avec `--ledger`,
   la clé CAL de test est lue dans `infra/keys/cal-test.pem` ou `BADGE_CAL_TEST_KEY` (voir `@badge/ledger`).

## Configuration

| Variable                     | Défaut                  | Rôle                                                                     |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `BADGE_SESSION_KEY_FILE`     | (obligatoire)           | Fichier de session ; `--session <fichier>` le remplace.                  |
| `BADGE_ENCLAVE_URL`          | `http://127.0.0.1:8787` | Origine de l'enclave.                                                    |
| `BADGE_ENCLAVE_TRANSPORT`    | `channel`               | `channel` (canal attesté) ou `plain` (développement, simulateur requis). |
| `BADGE_ATTESTATION_MODE`     | `tdx`                   | `tdx` (vrai TEE) ou `simulated` (simulateur dstack).                     |
| `BADGE_ENCLAVE_COMPOSE_HASH` | —                       | Compose hash épinglé, obligatoire en `tdx`.                              |
| `BADGE_MCP_TRANSPORT`        | `stdio`                 | `stdio` ou `http` (`--http`).                                            |
| `BADGE_MCP_HTTP_PORT`        | `8790`                  | Port HTTP local (`--port`).                                              |

Les journaux vont sur la sortie d'erreur : en stdio, la sortie standard ne porte que le protocole MCP.

## Brancher sur une harness

`tsx` est fourni par le dépôt : `<badge>` désigne le chemin absolu du dépôt.

**Claude Code** (stdio) :

```sh
claude mcp add badge --scope user \
  -e BADGE_SESSION_KEY_FILE=$HOME/.badge/alice-claude.json \
  -e BADGE_ATTESTATION_MODE=simulated \
  -- <badge>/node_modules/.bin/tsx <badge>/apps/mcp/src/main.ts
```

En production, remplacer `BADGE_ATTESTATION_MODE=simulated` par `-e BADGE_ATTESTATION_MODE=tdx
-e BADGE_ENCLAVE_COMPOSE_HASH=<compose hash publié> -e BADGE_ENCLAVE_URL=https://<enclave>`.

Claude Code en HTTP (serveur lancé à part avec `pnpm --filter @badge/mcp start --http`) :

```sh
claude mcp add --transport http badge http://127.0.0.1:8790/mcp
```

**Cursor** (`~/.cursor/mcp.json` ou `.cursor/mcp.json` du projet) :

```json
{
  "mcpServers": {
    "badge": {
      "command": "<badge>/node_modules/.bin/tsx",
      "args": ["<badge>/apps/mcp/src/main.ts"],
      "env": {
        "BADGE_SESSION_KEY_FILE": "/Users/alice/.badge/alice-cursor.json",
        "BADGE_ATTESTATION_MODE": "simulated"
      }
    }
  }
}
```

Une clé de session par agent : Claude Code et Cursor de la même employée ont chacun leur fichier, révocable
séparément.

## Tests

```sh
pnpm vitest run --project mcp           # outils (faux BadgeClient), client MCP en mémoire, HTTP, fichier de session
pnpm --filter @badge/mcp test:sim       # bout en bout par le canal attesté (infra/dstack-sim.sh start)
```
