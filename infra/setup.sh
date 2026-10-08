#!/usr/bin/env bash
# Fetches local dev dependencies: Speculos image, Ethereum app ELF (Flex), Semaphore artifacts, test CAL key.
# The develop ELF (address book support) is built by build-eth-app.sh; the release ELF is the fallback.
#
# Every artifact is pinned (image digest, release version, commit) and checked against its SHA-256: a fresh machine
# gets exactly what the demo was tested with, and a corrupted or tampered download is deleted instead of used.
set -euo pipefail
cd "$(dirname "$0")"

# shellcheck source=speculos-image.sh
. ./speculos-image.sh

ETH_RELEASE_VERSION="1.22.3"
ETH_RELEASE_SHA256="88ce93fe2b982c05f37aef108c1ea40f251ae394c25bb8232eb6a8adb3feaa5d"
SEMAPHORE_ARTIFACTS_VERSION="4.13.0"
SEMAPHORE_DEPTH=16
SEMAPHORE_WASM_SHA256="06df31461d17db86897fc234f0e6e5f5e2f6add1b8c821b5c6ae75030b3e0d7c"
SEMAPHORE_ZKEY_SHA256="948763c7315a337b7722c0344a28af4be66fbbc618474d6dbe9036e799d1a3b5"
# Last app-ethereum commit that touched the test key (pinned: the develop branch moves).
CAL_TEST_KEY_COMMIT="e5c82d910ef4680f8b2b96137412088ca032b2ca"
CAL_TEST_KEY_URL="https://raw.githubusercontent.com/LedgerHQ/app-ethereum/${CAL_TEST_KEY_COMMIT}/client/src/ledger_app_clients/ethereum/keychain/cal.pem"
CAL_TEST_KEY_SHA256="034369fc044dcb46f67ebe5c5f7e35089d518d9edf51b0b622d8afff7fee9bf2"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# fetch <url> <destination> <sha256>: downloads once, then verifies the file on every run.
fetch() {
  local url="$1" dest="$2" expected="$3"
  mkdir -p "$(dirname "$dest")"
  if [ ! -s "$dest" ]; then
    curl -fsSL --retry 3 -o "$dest.part" "$url" || { rm -f "$dest.part"; echo "download failed: $url" >&2; exit 1; }
    mv "$dest.part" "$dest"
  fi
  local actual
  actual="$(sha256_of "$dest")"
  if [ "$actual" != "$expected" ]; then
    rm -f "$dest"
    echo "checksum mismatch for $dest (expected $expected, got $actual): deleted, re-run to download it again" >&2
    exit 1
  fi
}

docker info >/dev/null 2>&1 || { echo "Docker is not running (macOS: open -a Docker)" >&2; exit 1; }
docker image inspect "$SPECULOS_IMAGE" >/dev/null 2>&1 || docker pull -q "$SPECULOS_IMAGE" >/dev/null

fetch "https://github.com/LedgerHQ/app-ethereum/releases/download/${ETH_RELEASE_VERSION}/app-${ETH_RELEASE_VERSION}-flex.elf" \
  "apps/app-${ETH_RELEASE_VERSION}-flex.elf" "$ETH_RELEASE_SHA256"
fetch "https://snark-artifacts.pse.dev/semaphore/${SEMAPHORE_ARTIFACTS_VERSION}/semaphore-${SEMAPHORE_DEPTH}.wasm" \
  "zk-artifacts/semaphore-${SEMAPHORE_DEPTH}.wasm" "$SEMAPHORE_WASM_SHA256"
fetch "https://snark-artifacts.pse.dev/semaphore/${SEMAPHORE_ARTIFACTS_VERSION}/semaphore-${SEMAPHORE_DEPTH}.zkey" \
  "zk-artifacts/semaphore-${SEMAPHORE_DEPTH}.zkey" "$SEMAPHORE_ZKEY_SHA256"
# Public TEST CAL key of app-ethereum: signs our EIP-712 filters, accepted by Speculos only (never a real device).
fetch "$CAL_TEST_KEY_URL" "keys/cal-test.pem" "$CAL_TEST_KEY_SHA256"

echo "OK: Speculos image pinned, $(ls -1 apps/*.elf zk-artifacts/semaphore-* keys/*.pem | tr '\n' ' ')(checksums verified)"
