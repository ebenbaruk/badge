#!/usr/bin/env bash
# Fetches local dev dependencies: Speculos image, Ethereum app ELFs (Flex), Semaphore artifacts, test CAL key.
# The develop ELF (address book support) is built by build-eth-app.sh; the release ELF is the fallback.
set -euo pipefail
cd "$(dirname "$0")"

ETH_RELEASE_VERSION="1.22.3"
SEMAPHORE_ARTIFACTS_VERSION="4.13.0"
SEMAPHORE_DEPTH=16
CAL_TEST_KEY_URL="https://raw.githubusercontent.com/LedgerHQ/app-ethereum/develop/client/src/ledger_app_clients/ethereum/keychain/cal.pem"

docker info >/dev/null 2>&1 || { echo "Docker is not running (open -a Docker)"; exit 1; }
docker pull -q ghcr.io/ledgerhq/speculos:latest

release_elf="apps/app-${ETH_RELEASE_VERSION}-flex.elf"
[ -s "$release_elf" ] || curl -fL -o "$release_elf" \
  "https://github.com/LedgerHQ/app-ethereum/releases/download/${ETH_RELEASE_VERSION}/app-${ETH_RELEASE_VERSION}-flex.elf"

for ext in wasm zkey; do
  f="zk-artifacts/semaphore-${SEMAPHORE_DEPTH}.${ext}"
  [ -s "$f" ] || curl -fL -o "$f" \
    "https://snark-artifacts.pse.dev/semaphore/${SEMAPHORE_ARTIFACTS_VERSION}/semaphore-${SEMAPHORE_DEPTH}.${ext}"
done

# Public TEST CAL key of app-ethereum: signs our EIP-712 filters, accepted by Speculos only (never a real device).
mkdir -p keys
[ -s keys/cal-test.pem ] || curl -fsSL -o keys/cal-test.pem "$CAL_TEST_KEY_URL"

[ -s apps/app-1.23.0-dev-flex.elf ] || echo "Note: develop ELF missing, run ./build-eth-app.sh for contact names"
echo "OK: $(ls -1 apps/*.elf zk-artifacts/semaphore-* keys/*.pem | tr '\n' ' ')"
