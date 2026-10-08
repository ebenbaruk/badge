# @badge/mcp

MCP server that plugs Badge into each employee's agent harness (Claude Code, Cursor...). It acts for **a single
employee**, with the session key that employee delegated to their agent by signing an `AgentSession` on their Ledger,
and talks to the enclave over the attested channel of `@badge/client`.

## Tools

| Tool                     | Input               | What the agent gets                                                                                                                                                                          |
| ------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `badge_get_context`      | `{task, taskLabel}` | Creates a task; returns the brief drafted in the enclave and the provenance of each excerpt, or the pending consents ("Waiting for Bob Durand to approve on their Ledger") with the task id. |
| `badge_task_status`      | `{taskId}`          | Task status; brief and provenance once nothing is pending anymore.                                                                                                                           |
| `badge_list_my_consents` | none                | Share requests addressed to the employee (requester, excerpt, task, risk). The agent cannot approve them: the employee signs on their Ledger.                                                |
| `badge_attestation`      | none                | Enclave measurement and attestation summary (verified TDX or simulated, compose hash, TCB), compared with the measurement signed in the session.                                             |

Descriptions are written for an LLM, in English. Enclave refusals (unknown session, mass-extraction rules...) come
back as readable tool errors, not protocol failures.

## Guarantees

- **Nothing but what the enclave released**: a colleague's text only appears in a brief the enclave drafted from
  released excerpts (signed consent, standing agreement). The brief is fenced
  (`<<<BADGE_CONTEXT ... BADGE_CONTEXT>>>`) and flagged as data, not instructions.
- **Fail closed at startup**: in `tdx` mode, the server refuses to start if attestation fails (including an
  unreachable enclave); in every mode, a rejected attestation or a measurement different from the one signed in the
  `AgentSession` stops it from starting. The `plain` transport (no attestation) is only accepted with the simulator.
- **Session key**: read from a `600` file (refused if readable by others), never logged nor printed. It only grants
  the right to _request_ context: every share is still signed on the owner's Ledger.
- **HTTP mode**: listens on `127.0.0.1` only, DNS rebinding protection (`Host` header) and refusal of any request
  carrying an `Origin` header (a web page cannot drive the agent's session).

## Setup (once per employee and per agent)

1. Create the session key and the message to sign (the enclave is attested to read its measurement):

   ```sh
   BADGE_ATTESTATION_MODE=simulated pnpm --filter @badge/mcp session create \
     --employee 0x9858EfFD232B4033E47d90003D41EC34EcaEda94 --out ~/.badge/alice-claude.json --agent "Claude Code"
   ```

   The file (mode `600`) holds the private key and the `AgentSession`; the command prints the message (`@badge/consent`
   wire format) and its EIP-712 fingerprint. Lifetime: 8 h by default, 12 h at most (`--ttl-hours`).

2. Have the `AgentSession` signed on the employee's Ledger and open the session in the enclave:

   ```sh
   # signature obtained elsewhere (web app, @badge/ledger):
   pnpm --filter @badge/mcp session open --file ~/.badge/alice-claude.json --signature 0x...
   # or directly on a Speculos device (approve on the device screen):
   pnpm --filter @badge/mcp session open --file ~/.badge/alice-claude.json --ledger http://localhost:5001
   ```

   The signature is checked locally (it must come from the employee's address) before it is sent. With `--ledger`,
   the test CAL key is read from `infra/keys/cal-test.pem` or `BADGE_CAL_TEST_KEY` (see `@badge/ledger`).

## Configuration

| Variable                             | Default                 | Role                                                                                                 |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `BADGE_SESSION_KEY_FILE`             | (required)              | Session file; `--session <file>` overrides it.                                                       |
| `BADGE_ENCLAVE_URL`                  | `http://127.0.0.1:8787` | Enclave origin.                                                                                      |
| `BADGE_ENCLAVE_TRANSPORT`            | `channel`               | `channel` (attested channel) or `plain` (development, simulator required).                           |
| `BADGE_ATTESTATION_MODE`             | `tdx`                   | `tdx` (real TEE) or `simulated` (dstack simulator).                                                  |
| `BADGE_ENCLAVE_COMPOSE_HASH`         | -                       | Pinned compose hash (otherwise read from the pins file).                                             |
| `BADGE_ENCLAVE_APP_ID`               | -                       | Pinned dstack app id (otherwise read from the pins file).                                            |
| `BADGE_ENCLAVE_OS_MEASUREMENTS_FILE` | -                       | `infra/cvm/expected-measurements.json`; in `tdx`, compose hash, app id and OS measurements required. |
| `BADGE_MCP_TRANSPORT`                | `stdio`                 | `stdio` or `http` (`--http`).                                                                        |
| `BADGE_MCP_HTTP_PORT`                | `8790`                  | Local HTTP port (`--port`).                                                                          |

Logs go to stderr: in stdio mode, stdout only carries the MCP protocol.

## Plug into a harness

`tsx` ships with the repo: `<badge>` is the absolute path of the repo.

**Claude Code** (stdio):

```sh
claude mcp add badge --scope user \
  -e BADGE_SESSION_KEY_FILE=$HOME/.badge/alice-claude.json \
  -e BADGE_ATTESTATION_MODE=simulated \
  -- <badge>/node_modules/.bin/tsx <badge>/apps/mcp/src/main.ts
```

In production, replace `BADGE_ATTESTATION_MODE=simulated` with `-e BADGE_ATTESTATION_MODE=tdx
-e BADGE_ENCLAVE_OS_MEASUREMENTS_FILE=<badge>/infra/cvm/expected-measurements.json -e BADGE_ENCLAVE_URL=https://<enclave>`
(the published file pins compose hash, app id, OS measurements and KMS).

Claude Code over HTTP (server started separately with `pnpm --filter @badge/mcp start --http`):

```sh
claude mcp add --transport http badge http://127.0.0.1:8790/mcp
```

**Cursor** (`~/.cursor/mcp.json` or the project's `.cursor/mcp.json`):

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

One session key per agent: the same employee's Claude Code and Cursor each have their own file, revocable
separately.

## Tests

```sh
pnpm vitest run --project mcp           # tools (fake BadgeClient), in-memory MCP client, HTTP, session file
pnpm --filter @badge/mcp test:sim       # end to end over the attested channel (infra/dstack-sim.sh start)
```
