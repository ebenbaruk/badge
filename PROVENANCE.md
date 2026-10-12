# Provenance

What existed before the contest, what comes from third parties, and under which licence. Article 18 of the Ledger N3XT Hackathon @ OP3N 2026 terms disqualifies undisclosed pre-existing code, designs or assets, so this page lists all of them.

## Before and during the contest

The contest ran from 7 Oct 2026, 15:00, to 13 Oct, 23:59. The terms give these times in CET; asked on 23 Sept, the organisers told us in writing that the contest's "CET" means Paris time, which is UTC+2 in October. The first commit of this repository, `c7a96c2`, is dated 7 Oct 2026, 15:42:21 +0200.

Before the start, the team wrote a specification, a feasibility study and throwaway spikes in a separate private repository, which the jury can see on request. The spikes checked that the building blocks hold: EIP-712 signing and clear signing through the Device Management Kit on Speculos, the device address book, Honcho running locally, the dstack simulator, and a Semaphore identity derived from a signature.

No code from that repository was copied here. One test, `packages/ledger/test/clearSign.test.ts`, checks Badge's ContextShare payloads against values computed with the algorithm of a pre-contest prototype that had been validated on a Speculos Flex.

The team used AI coding assistants as working tools.

## Third-party pieces committed here

| Piece                                                                          | Where                                                           | Licence |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------- |
| 21 shadcn/ui components, generated with the shadcn CLI, then restyled          | `apps/web/src/components/ui/`                                   | MIT     |
| Montserrat and JetBrains Mono fonts, and the wordmark outlined from Montserrat | `apps/web/public/fonts/`, `design/fonts/`, `brand/wordmark.svg` | OFL-1.1 |
| Public BIP-39 test-vector mnemonics for the five emulated Ledgers              | `infra/speculos.sh`, one test                                   | MIT     |

Every visual in the repository is recorded with its source, licence and tooling in [`design/provenance.json`](design/provenance.json): the logo, the wordmark, the fonts, the icons, the Open Graph image, the landing illustrations generated with an image model from the team's prompts during the contest (prompts in [`apps/web/public/landing/ASSETS.md`](apps/web/public/landing/ASSETS.md)), and an illustration drawn as SVG in `design/art/`.

## Fetched by the scripts, not committed

| Piece                                                                                                                                                      | Fetched by                                                       | Licence                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| Honcho v3.2.2, the memory, cloned at its tag and built from its own Dockerfile (Python and uv base images) with one patched line and Badge's entry scripts | `infra/stack.sh`, `infra/honcho/Dockerfile`                      | AGPL-3.0               |
| tiktoken encodings `cl100k_base` and `o200k_base`, baked into the Honcho image                                                                             | `infra/stack.sh`                                                 | upstream terms         |
| Ledger's Ethereum app: the 1.22.3 release, or develop commit `e5b6dbff` built in Ledger's builder image                                                    | `infra/setup.sh`, `infra/build-eth-app.sh`                       | Apache-2.0             |
| app-ethereum's public test CAL key, at a pinned commit                                                                                                     | `infra/setup.sh`                                                 | Apache-2.0             |
| Speculos, Ledger's emulator, as an image pinned by digest                                                                                                  | `infra/speculos-image.sh`                                        | LGPL-3.0               |
| dstack simulator 0.5.3                                                                                                                                     | `infra/dstack-sim.sh`                                            | Apache-2.0             |
| Semaphore v4 circuit artifacts, depth 16                                                                                                                   | `infra/setup.sh`                                                 | MIT                    |
| pgvector, nginx and Node.js base images                                                                                                                    | `infra/compose.yml`, `infra/gateway/`, `apps/enclave/Dockerfile` | upstream terms         |
| npm packages                                                                                                                                               | `pnpm-lock.yaml`                                                 | each package's licence |

`infra/setup.sh` and `infra/dstack-sim.sh` check what they download against pinned SHA-256 values.

## Licences

The code in this repository is under the MIT licence ([LICENSE](LICENSE)). The memory image that Badge builds and deploys, `ghcr.io/ebenbaruk/badge-honcho`, is Honcho v3.2.2 under AGPL-3.0; its source is the upstream v3.2.2 tag plus the files in `infra/honcho/`.
