# AGENTS.md

Guidance for coding agents working in this repository (Codex reads `AGENTS.md`; `CLAUDE.md` is a symlink to this
file so Claude Code reads the same text). Edit `AGENTS.md` only: both stay identical by construction.

Badge: a confidential memory layer for AI-native companies. It holds global company context and per-employee
personal context inside a TEE (Phala dstack, Intel TDX). A personal excerpt only leaves its owner's scope with a
consent signed on the owner's Ledger. Hackathon submission (Ledger N3XT @ OP3N 2026). The repo goes public at
submission. `.claude/` and `CLAUDE.local.md` stay gitignored.

## Commands

pnpm 11 monorepo, Node ≥ 24, TypeScript 6.0.3. Not TS 7: typescript-eslint does not support it.

```bash
pnpm install
pnpm typecheck          # every package + scripts/ and infra/**/*.ts (tsconfig.scripts.json)
pnpm test               # all vitest projects (packages/*, apps/enclave, apps/mcp, apps/web), no device needed
pnpm lint               # eslint + prettier --check ; `pnpm format` to fix
pnpm --filter @badge/web build

# single project / single file / single test
pnpm vitest run --project enclave
pnpm vitest run --project consent packages/consent/test/verify.test.ts
pnpm vitest run --project enclave -t "binds the label"
```

Suites that need running infrastructure, kept outside the default run:

- `pnpm --filter @badge/ledger test:speculos`: real signing on Speculos.
- `pnpm --filter @badge/attest|@badge/enclave|@badge/mcp test:sim`: dstack simulator.
- `pnpm --filter @badge/enclave test:live`: Honcho stack + LLM.

Local demo (full guide for humans: `INSTALL.md`):

```bash
scripts/bootstrap.sh   # prerequisites, install, artifacts, 5 Speculos, dstack simulator, Honcho stack, seed (idempotent)
pnpm demo              # 18-step live end-to-end scenario; starts its own enclave (8788 if the web demo holds 8787)
pnpm demo:web          # enclave :8787 + demo:prepare + web :3000 (production build, presenter mode)
pnpm demo:web --fresh | --rehearsal | --dev     # clean state | "Auto review" button | Next dev server
pnpm demo:web stop | status | logs [web|enclave]
```

`pnpm demo:web` (`scripts/demo-web.sh`) is the way to bring the web demo up, and to bring it back. Agent sessions
last 8 hours by design ("one working day"). When they expire, the UI says the session has expired and the enclave
refuses requests. Re-running `pnpm demo:web` renews them all: `pnpm demo:prepare` (`scripts/prepare-demo.ts`) signs
the setup on the Speculos Ledgers, with every review auto-approved since it is setup, then writes the session keys
into `apps/web/.data`. It must run while the web server is stopped, and the launcher handles that ordering.
Processes started by the launcher log to `infra/.data/demo-web/`.

Individual pieces, if needed: `infra/setup.sh`, `infra/speculos.sh` (alice 5001, bob 5002, chloe 5003, david 5004,
emma 5005), `infra/dstack-sim.sh start` (:8090), `infra/stack.sh up && infra/stack.sh seed` (Honcho on :8000),
`pnpm --filter @badge/enclave start` (:8787, `BADGE_DATA_DIR` for a fresh DB),
`BADGE_CAL_TEST_KEY=$PWD/infra/keys/cal-test.pem [BADGE_REHEARSAL=1] pnpm --filter @badge/web dev`.
`pnpm desks:seed` only enrolls David and Emma into the Research desk; `pnpm demo:prepare` already includes it.

`scripts/` imports web modules through the `@/*` → `apps/web/src/*` path alias (`scripts/tsconfig.json`,
`tsconfig.scripts.json`): `prepare-demo.ts` writes agent sessions with the web's own `AgentStore`, so changing that
store's format (`apps/web/src/server/agent-store.ts`) must keep `pnpm demo:prepare` working.

Pinned artifacts: the Speculos image digest lives in `infra/speculos-image.sh`; the Ethereum app, Semaphore circuits
and test CAL key are fetched by `infra/setup.sh` and checked against SHA-256 values there. Bumping any of them means
updating the pin and its checksum together, otherwise setup refuses the file.

Against a deployed CVM:

```bash
BADGE_ENCLAVE_URL=<endpoint> BADGE_ENCLAVE_OS_MEASUREMENTS_FILE=infra/cvm/expected-measurements.json pnpm demo
```

Phala: `infra/phala-up.sh` (refuses without `PHALA_CONFIRM_SPEND=yes`), `infra/phala-status.sh`,
`infra/phala-down.sh` (stops AND deletes). Images: `infra/cvm/build-push.sh push`, which pins digests into
`infra/cvm/compose.yml`. Commit that file, because its hash is the enclave measurement. Rehearse the CVM compose
locally first with `infra/cvm/rehearse.sh up [--real-llm] | check | down`. Never leave a CVM running, and ask
before any spend.

Secrets: `.env` at the repo root (gitignored), else `../.env`, or `BADGE_ENV_FILE`; template in `.env.example`
(`BUILD_LLM_*`, `PHALA_AI_*`, `PHALA_CLOUD_API_KEY`). Scripts read them by name and never print them.

## Architecture

Package graph, no cycles:

- `consent`: pure; the shared EIP-712 contract.
- `ledger`, `zk`, `attest`: depend on `consent`.
- `client`: SDK over `attest` + `consent`.
- apps: `enclave`, `web`, `mcp` and `scripts/` consume the packages.

Packages export TS source directly (`"exports": "./src/index.ts"`, Bundler resolution). There is no build step except
Next.

- **`packages/consent`**: `src/messages.ts` is the single source of truth for every signed message (EmployeeEnroll,
  AgentSession, ContextShare, ContextPolicy, ContextRevoke, DeskJoin, DeskShare) and their clear-sign descriptors.
  Two device constraints drive its design:
  - The Ledger displays fields in **struct order**, so displayed fields come first.
  - The Ledger renders **ASCII only** (`toDeviceAscii`).

  A test enforces both invariants. Changing a device label or intent also changes the golden filter hex in
  `packages/ledger/test/clearSign.test.ts` (recompute it, never guess) and must be checked on Speculos
  (`test:speculos`). Changing an EIP-191 derivation message (`deskIdentityDeriveMessage`, `complianceKeyDeriveMessage`)
  changes the derived desk identities and compliance key: existing demo state is then stale (`pnpm demo:web --fresh`).
  The package also holds the wire codecs (bigints as decimal strings) and the
  fail-closed `verifyBadgeSignature` + `check*` validators. Stateful checks (nonces, revocation) belong to the
  enclave.

- **`packages/ledger`**: DMK wrapper (`LedgerSigner`) plus the Speculos driver (`SpeculosDevice`, `autoRespond`).
  - Clear signing compiles our descriptors into EIP-712 filters signed with app-ethereum's **test** CAL key.
    Speculos accepts them; a real device would need a Ledger-signed ERC-7730 descriptor.
  - DMK versions are pinned exactly.
  - Hold-to-sign must be press / wait / release.
- **`packages/zk`**: Semaphore v4.
  - The identity secret is keccak256 of a deterministic Ledger EIP-191 signature, never stored.
  - Depth is always 16, and message and scope are bigints.
  - `verifyDeskProof` alone is insufficient: the root must equal the desk root snapshotted at request time.
- **`packages/attest`**: TDX quote parsing, RTMR replay, compose hash and dcap-qvl verification (`mode: tdx |
simulated`). It also holds the attested channel (X25519 + HKDF + AES-GCM, `report_data = sha512(nonce‖clientPk‖enclavePk)`),
  sealed boxes and the compliance key derivation.
  - `./server` is Node-only (dstack SDK); the rest is browser-safe and uses noble v1, which dstack-sdk requires.
  - A real dstack CVM returns empty RTMR3 digests; they are derived from the payloads.
- **`packages/client`**: `BadgeClient` with a typed method per route.
  - `api-schemas.ts` defines the response shapes the enclave must return.
  - `request-auth.ts` and `channel-wire.ts` are imported by the enclave so the two ends cannot drift.
  - `enclavePinsFromEnv` reads the attestation pins.
- **`apps/enclave`**: Hono service, the authority on everything.
  - `createApp(deps)` is pure, with deps injected. `main.ts` / `server.ts` wire the real dependencies: node:sqlite,
    HonchoMemory, the LLM profile and dstack.
  - Request auth uses session-key signatures (`security/auth.ts`). Production requires the attested channel
    (`BADGE_REQUIRE_CHANNEL`).
  - Modules:
    - `policy`: consents, grants, standing policies, revocations, deterministic mass-extraction rules in `rules.ts`.
    - `tasks`: candidate selection → classifier → allowed / pending / blocked → brief.
    - `desks`: ZK shares.
    - `audit`: append-only hash chain with a KMS-signed head.
    - `compliance`, `security`, `memory`, `llm`.
  - The enclave **prepares** the exact messages owners sign (ContextShare, ContextRevoke), then verifies them.
  - Error envelope `{error: {code, message}}`, codes UPPER_SNAKE.
  - Contract: `docs/enclave-api.md`. Keep it in sync with routes and `api-schemas.ts`.
- **`apps/web`**: Next.js 16 / React 19 / Tailwind v4 / shadcn.
  - The server side is the per-employee device bridge (Speculos via `@badge/ledger`) and the agent runtime. It talks
    to the enclave through `@badge/client` (`src/server/enclave/live.ts`); `BADGE_ENCLAVE_MODE=mock` is for UI work
    only.
  - The UI never computes risk; it shows the enclave's verdicts. The enclave rates every candidate excerpt of a task,
    so one compromised-agent request yields several `rule.*` audit entries: the web groups them per request for display
    only (`src/server/enclave/alerts.ts`, `src/lib/rule-findings.ts`). The audit chain itself keeps every entry.
  - Device routes are CSRF-guarded. Auto-review only exists with `BADGE_REHEARSAL=1`.
  - Agent runtime state persists in `BADGE_WEB_DATA_DIR`.
  - "/" is the marketing landing (`src/components/landing`). Its example data (one consent request in a Coinbase
    workspace, built from the real `@badge/consent` descriptors and hashing, labelled as illustrative) lives in
    `src/components/landing/example.ts`.
    The app lives under `/[employee]/…`, with `/demo` as the entry.
- **`apps/mcp`**: MCP server for one employee's agent harness. It acts with that employee's AgentSession key over the
  attested channel, and renders third-party text as quoted data. `session` CLI: create the key, sign on Ledger.
- **Memory**: unmodified Honcho v3.2.2 cloned into `infra/vendor/`, plus a thin image layer
  (`infra/honcho/Dockerfile`): tiktoken cache and a one-line gpt-6 `max_completion_tokens` patch.
  - Honcho reads all scopes; only the enclave's policy engine decides what leaves.
  - All LLM traffic goes through the single egress gateway (`infra/gateway`). Its upstream host is pinned in the
    attested artifact, and only the key is a secret.
  - Switching LLM profile (build ↔ phala) needs `infra/stack.sh reset` and a re-seed.

## Conventions specific to this repo

- Commits: small, conventional, written **in French** (`feat(enclave): …`).
  - **No `Co-Authored-By` trailer**, and no mention of AI assistants or "lab" in commit messages or other tracked
    files. `AGENTS.md` and its `CLAUDE.md` symlink are the only agent-related files tracked, on purpose.
  - The sibling `../lab` repo (research spikes, spec) is private and is never referenced from here.
- Everything the jury sees is in English: UI and landing copy, Ledger screens, the Coinbase dataset (illustrative, not affiliated with Coinbase or Morpho), LLM outputs, the
  `pnpm demo` narration and MCP texts (locale `en-US`). Docs (`README.md`, `docs/`) are still in French for now.
  Strings shown on the Ledger are ASCII. Code comments are in English and explain why.
- Never mention Plastic Labs or Neuromancer in product copy or the pitch.
- Demo identities use public BIP-39 test mnemonics (in `infra/speculos.sh`); Ledger addresses are in
  `infra/seed/coinbase.json`.

## The demo is a living thing

Badge ships as a back-end product: a confidential memory that holds the company context and every employee's
personal context, injects the right context for each task, and asks the owner's Ledger before a personal excerpt
leaves. The web app and the Speculos Ledgers exist to make that visible to a jury in five minutes. The walkthrough is
in `INSTALL.md` §4 and the pitch beats are in `README.md` ("Le scénario de démonstration").

- Run the walkthrough yourself before changing anything: `pnpm demo:web --fresh --rehearsal`, then follow INSTALL.md §4.
- Proposals that make the demo smoother or clearer for a jury are welcome: copy, ordering, what a screen emphasises,
  fewer clicks. Examples are a step that needs explaining, a label that reads like jargon, or a wait with no feedback.
  Describe the change and get the go-ahead of the person you are working with (Eli or Alexandre, the two
  presenters) before making it. They decide what the jury sees.
- Keep the guarantees intact: every personal excerpt still needs a Ledger signature or a signed standing agreement,
  the UI never computes risk itself, and the clear-signing screens stay exact.
- After a change: `pnpm typecheck && pnpm test && pnpm lint`, `pnpm demo` (18/18), then play the walkthrough in the
  browser with `pnpm demo:web` (presenter mode, real hold-to-sign) and update INSTALL.md §4 if a label moved.
