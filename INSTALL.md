# Running Badge locally

Everything in Badge runs on your machine. You don't need a cloud account, a physical Ledger or a TEE:

| Piece      | Locally                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Ledgers    | 5 **Speculos** devices (Ledger's official emulator, Flex model) running the real Ethereum app binary |
| Signatures | Real EIP-712 clear signing and EIP-191 messages, verified by the enclave                             |
| TEE        | **dstack simulator**: same API as a Phala CVM, with a fixed quote. The UI says "Simulated TEE"       |
| Memory     | Honcho + Postgres/pgvector in Docker, holding the fictional company Acme (15 notes, 5 employees)     |
| LLM        | Any OpenAI-compatible API, reached only through an egress gateway container that holds the key       |
| ZK         | Real Semaphore v4 Groth16 proofs                                                                     |

The same code also runs in a real Intel TDX CVM on Phala Cloud ([`docs/DEPLOY.md`](docs/DEPLOY.md)). That setup is
optional and costs money, so the steps below never start it.

## 1. Requirements

- **macOS on Apple Silicon** or **Linux x86-64**. The dstack simulator ships binaries for these two platforms only.
- **Docker** with the Compose plugin, running. Plan for about 8 GB of RAM for Docker and 10 GB of disk.
- **Node.js 24** and **pnpm 11**. `corepack enable` provides pnpm.
- `git`, `curl`, `openssl`, `perl` and `lsof`. They come with macOS and most Linux distributions.
- **An OpenAI API key**, or a key for any OpenAI-compatible endpoint that supports structured outputs and embeddings.
  A full demo run costs a few cents.

## 2. Install

```bash
git clone https://github.com/ebenbaruk/badge.git && cd badge
cp .env.example .env && chmod 600 .env
# edit .env: set BUILD_LLM_API_KEY (the other values are tested defaults)
scripts/bootstrap.sh
```

`scripts/bootstrap.sh` performs these steps:

1. Checks the prerequisites.
2. Installs the workspace.
3. Downloads the artifacts: Speculos image, Ethereum app, Semaphore circuits and the public test key for clear
   signing.
4. Starts the 5 Ledgers (Alice :5001, Bob :5002, Chloé :5003, David :5004, Emma :5005).
5. Starts the dstack simulator (:8090) and the memory stack (:8000).
6. Loads the Acme dataset and checks recall.

The first run takes 10 to 20 minutes because it builds the Honcho image. After that it takes a few seconds and can be
re-run at any time.

The secrets file stays outside git. Scripts read variable names only, never print values, and only the egress gateway
container receives the API key.

## 3. See it work

### Scripted run: `pnpm demo` (about 5 minutes)

This command runs the whole scenario end to end against the real local stack:

- it starts its own enclave on a fresh database;
- it drives the 5 Ledgers automatically;
- it checks each of the 18 steps and stops at the first discrepancy.

```bash
pnpm demo
```

If the web demo below is already running, its enclave holds port 8787. In that case run
`BADGE_DEMO_ENCLAVE_PORT=8788 pnpm demo`.

### Web demo: `pnpm demo:web`

```bash
pnpm demo:web            # stack check, enclave, demo preparation, web app (production build)
```

Then open **http://localhost:3000** for the landing page and **http://localhost:3000/demo** for the product. Use a
window **at least 1280 px wide**: the right-hand panel mirrors the current employee's Ledger.

The preparation signs everything the setup pages would otherwise ask for on the Speculos Ledgers, and approves those
reviews automatically:

- Alice, Bob and Chloé enrolled, with agent sessions delegated;
- the Research desk complete (Bob, David and Emma);
- Chloé's compliance key registered.

You start directly at the walkthrough below.

| Command                             | Effect                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm demo:web`                     | Start or restart. Also renews the agent sessions, which last 8 hours                    |
| `pnpm demo:web --fresh`             | Archive the previous demo state first (`infra/.data/archive/`): a clean run             |
| `pnpm demo:web --rehearsal`         | Adds "Auto review" under the Ledger mirror to approve a whole review at once (practice) |
| `pnpm demo:web --dev`               | Next.js dev server with hot reload instead of the production build                      |
| `pnpm demo:web status`              | What runs, and until when the agent sessions are valid                                  |
| `pnpm demo:web logs [web\|enclave]` | Follow a log                                                                            |
| `pnpm demo:web stop`                | Stop the web app and the enclave. Docker containers and the simulator keep running      |

An agent session is the delegation an employee signs to their agent: it lasts one working day (8 hours), like a badge.
When one expires, run `pnpm demo:web` again. An employee can also click **Setup → Renew session**, which costs one
Ledger signature.

To stop everything: `pnpm demo:web stop && infra/speculos.sh stop && infra/dstack-sim.sh stop && infra/stack.sh down`.
`infra/stack.sh down` keeps the memory; `infra/stack.sh reset` erases it.

## 4. Web demo walkthrough

Acme is a fictional company:

- **Alice Martin** (Sales) prepares a meeting with the client Orion.
- **Bob Durand** (Key Accounts) owns the Orion notes in his personal context.
- **Chloé Bernard** (Legal & Compliance) audits.
- **David Moreau** and **Emma Leroy** sit with Bob on the Research desk.

Switch employee with the selector at the top left. The whole run takes about 5 minutes.

**Using the Ledger mirror**

- A click is a tap.
- A swipe to the left goes to the next page.
- To sign, **press and hold "Hold to sign" for about 3 seconds**. A short click does nothing.
- To refuse, tap **Reject**, then **Yes, reject**.

1. **The right context, found on its own (Alice → Agent).**
   - Pick the suggestion "Prepare the brief for tomorrow's meeting with client Orion" and click **Send**.
   - The company context and Alice's own notes pass immediately.
   - The callout reads "Badge found relevant context in Bob Durand's memory on its own; Alice never asked for it."
     Bob's 3 excerpts stay sealed in the enclave until he consents, and Alice sees none of their text.
   - Bob's personal leave note is not even proposed.
2. **Consent on the Ledger (Bob → Consent requests).**
   - There is one card per excerpt. Each shows the text, the risk, and exactly what the Ledger will display.
   - Click **Approve on my Ledger**. The mirror lights up.
   - Swipe through Share with / Excerpt / Length / Task / Expires / Fingerprint / Enclave, then hold to sign.
   - Do the same for the other two excerpts.
3. **The brief (Alice → Agent).**
   - Every source carries its provenance ("Consent signed on Ledger", "Company context").
   - The token counter compares the context Badge selected with injecting everything: about half the tokens.
   - Chloé's confidential HR note is not in it.
4. **A compromised agent (Alice → Agent).**
   - Turn on **Compromised agent** and send any task. The agent asks for all of Bob's context.
   - The enclave's deterministic rules flag the request: one alert, with its reasons.
   - In **Bob → Consent requests**, the card is red ("Flagged by enclave rules"). Click **Approve on my Ledger**, then
     **Reject** on the device. Nothing is delivered.
   - An excerpt Bob had already granted in step 2 may be reused ("Consent reused"): the same text, nothing more.
5. **Revocation (Bob → Access & revocation).**
   - Click **Revoke everything for Alice** and sign.
   - The Ledger names the real scope: "Everything I shared with Alice Martin + Sales team agreements".
   - Bob's data key is rotated, and Alice's next request needs his consent again.
6. **No approval fatigue (Bob → Standing agreements).**
   - The form is prefilled: Sales team, tag `orion`, "client briefs", 800 characters, 30 days.
   - Click **Sign the agreement on my Ledger**.
   - Back in **Alice → Agent**, run the Orion brief again. It goes through without asking Bob ("Standing agreement
     from Bob"), and every use is logged.
7. **Chinese wall, anonymous (desks + ZK).**
   - **Alice → Desks**: click **Ask the Research desk** with the suggested question.
   - **Bob → Desks**: click **Share anonymously**. The device first signs the derivation of his anonymous identity,
     then the share.
   - **Alice → Desks**: the fact arrives as "Source: Research desk (anonymous member, ZK proof verified)". She knows
     one of Bob, David or Emma answered, not which.
8. **Compliance (Chloé → Compliance).**
   - The hash chain is verified, and its head is signed by the attested enclave.
   - The compromised agent's alert is shown, and the anonymous share is sealed.
   - Click **Reveal identity**, then sign on her Ledger: Bob appears, and the reveal itself is logged.

The same flow is available to any MCP-compatible agent harness (Claude Code, Cursor…) through `apps/mcp`
([`apps/mcp/README.md`](apps/mcp/README.md)).

## 5. Troubleshooting

| Symptom                                          | Fix                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap.sh`: secrets file not readable        | Create `.env` at the repository root from `.env.example` (or set `BADGE_ENV_FILE`).                                                 |
| "Hold to sign" does nothing                      | Press and **hold** about 3 seconds. For practice, use `pnpm demo:web --rehearsal` and "Auto review".                                |
| "Your agent's session has expired"               | Sessions last 8 hours: `pnpm demo:web` renews them (or Setup → Renew session).                                                      |
| Desk request refused (`ANONYMITY_SET_TOO_SMALL`) | The Research desk needs 3 Ledger members. `pnpm demo:web` prepares it; check `pnpm demo:web logs enclave`.                          |
| The mirror stops updating                        | A hidden tab is throttled by the browser. Bring the tab back to the front.                                                          |
| `6a80` when signing                              | The clear-signing test key is missing: re-run `scripts/bootstrap.sh`. A real Ledger always refuses this test key (see README).      |
| A Speculos device is stuck                       | `infra/speculos.sh` restarts all five. Seeds are fixed, so addresses do not change.                                                 |
| The brief ignores Bob's notes                    | Memory not seeded: `infra/stack.sh status`, then `infra/stack.sh seed`. It is idempotent; re-run it if the deriver dropped a batch. |
| Port 8787 or 3000 already used                   | `pnpm demo:web stop`. If another program holds the port, the launcher names it.                                                     |
| Start over                                       | `pnpm demo:web --fresh`.                                                                                                            |
