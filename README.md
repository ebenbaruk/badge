# Badge

**Your agents know more. You decide what.**

Badge is a company memory for AI agents, and it turns each employee's Ledger into their company badge. Your agent gets the context it needs. If that's a colleague's notes, the colleague approves first, on their Ledger.

## The problem

Alice, in Sales, asks her agent to prepare tomorrow's meeting with a client. Bob has followed that client for years and keeps notes on it. The best context belongs to one person, and today it's all or nothing: Bob keeps his notes and her agent works blind, or everything goes to one server, its operator can read it all, and one prompt injection drains it. Access rights decide in advance who reads which folder; they cannot ask Bob about one paragraph and one task.

A tap for every action would stop an agent cold. We free the agent and guard the context.

## How it works

Badge is built to run in an enclave, a confidential VM (Intel TDX, on Phala Cloud) whose attestation every connecting app checks before sending anything.

1. On her Ledger, Alice gives her agent an 8-hour session key. Through the web app or any MCP client, the agent can ask for context but can never browse a colleague's notes or approve anything.
2. The enclave adds company context and Alice's own notes, and finds relevant notes in Bob's memory. It never selects notes he tagged personal, HR or confidential, and until Bob agrees, Alice sees none of his text.
3. Bob reads the full excerpt in Badge, then the request on his Ledger: "Share with: Alice Martin (Sales)", the start of the excerpt (60 characters at most) and its length, the task, the expiry, a fingerprint of the whole excerpt and the enclave measurement. He holds to sign. The brief is drafted from allowed excerpts only and goes to Alice's agent.
4. A hijacked agent, simulated in the demo by a request for all of Bob's context, tagged notes included, is flagged by the enclave's anti-scraping rules. Bob rejects it on his Ledger and nothing leaves. An excerpt over 8,000 characters, a task reaching more than 6 colleagues, or more than 60 excerpts asked of one person within an hour are refused before anyone is asked.
5. For routine use, Bob signs once: Sales may use his notes on that client for client briefs, for 30 days. Every use is logged, a flagged request still comes to him, and one signature revokes it all.
6. Across a Chinese wall, a desk answers under a zero-knowledge proof: Alice learns that a Research member shared, not who. The compliance log keeps the member's identity sealed to a key derived from the Ledger of Chloé, in compliance.

## Why Ledger

Without the Ledger, consent is a button the web server or a hijacked agent can press, and on a phone a compromised app can show one thing and sign another. On Ledger's current devices, from the Nano S Plus to the Flex, the screen is driven by the secure element. Badge's seven EIP-712 messages are clear-signed through Ledger's Device Management Kit; the five that enrol, delegate or release context carry the enclave measurement, so a consent signed for other code fails. Like a company badge, each employee's Ledger carries their identity: it enrols them, delegates to their agent, consents, revokes and derives their anonymous desk identity. The enclave guarantees which code runs; the Ledger guarantees that Bob, and only Bob, approved what leaves.

## Who pays, and what we ask

Companies pay per seat for the memory and consent layer in their own enclave, plus one Ledger per employee, used every day. We ask Ledger to sign Badge's clear-signing descriptors so a real Ledger shows these requests, and to help run a first pilot with a Ledger Enterprise customer.

## Real, simulated, and limits

- **Ledger:** five Speculos Flex emulators run Ledger's Ethereum app on public test seeds. Their requests are approved by a script in `pnpm demo`, and the live steps by hand on a screen mirror in the web demo. Only the Speculos transport is wired, and the clear-signing filters use app-ethereum's test key, which only Speculos accepts.
- **Enclave:** on your machine, Badge runs on the dstack simulator, which stands in for Phala's TEE, and the app shows an amber "Simulated TEE" label instead of the green "Attested enclave" one. The services are also packaged for an Intel TDX VM on Phala Cloud (`infra/cvm/`). A first deployment ran there on 7 Oct, with its measurements pinned in the repo; we start the VM for live demos and stop it afterwards, as it is billed by the hour.
- **Real in both:** Ledger signatures and their checks, the encrypted channel, Semaphore proofs, the policy engine, a hash-chained log that holds no excerpt text.
- **Model:** your OpenAI-compatible provider locally; from the VM, Phala Confidential AI behind one gateway, whose attestation Badge does not check. The model runs outside Badge's enclave and reads every note when it is stored and candidate excerpts before Bob signs: in the VM, the operator cannot read the memory, but the model provider sees what it processes.
- **Limits:** on the device, the fingerprint stands for everything past the start shown on screen. Revocation is enforced by the policy engine and cannot recall an excerpt already delivered. Desk anonymity holds against colleagues, not against the enclave, and in the demo rests on three members with public test seeds. The device screen shows the recipient, the start of the excerpt and the task: whoever can read Bob's screen or browser reads them too.

## Run it

Needs macOS (Apple Silicon) or Linux x86-64 (we used WSL2 on Windows), Docker, Node.js 24, pnpm 11 and an OpenAI-compatible API with structured outputs and embeddings.

```bash
git clone https://github.com/ebenbaruk/badge.git && cd badge
cp .env.example .env && chmod 600 .env   # set BUILD_LLM_API_KEY
scripts/bootstrap.sh   # 5 Speculos, dstack simulator, memory, demo data
pnpm demo              # 18 asserted steps, about 5 minutes, a few cents of LLM calls
pnpm demo:web          # http://localhost:3000/demo
pnpm test
```

Guides: [INSTALL.md](INSTALL.md) for the full local setup, [apps/mcp/README.md](apps/mcp/README.md) to connect an MCP client.

## Built during the contest

First commit `c7a96c2`: 7 Oct 2026, 15:42 Paris time (13:42 UTC), after the 15:00 start. No code from our pre-contest spikes was copied. We used AI coding assistants as working tools. Pre-contest work and every third-party piece with its licence: [PROVENANCE.md](PROVENANCE.md).

Licence: [MIT](LICENSE) for the code in this repository; the memory layer it builds on, Honcho, is under AGPL-3.0. Team: DVB (De Vinci Blockchain).
