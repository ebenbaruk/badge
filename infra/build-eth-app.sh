#!/usr/bin/env bash
# Builds app-ethereum `develop` for Flex with the address book enabled (shows "Alice (Sales)" instead of 0x...).
# No published release has this feature yet (1.23.0 pending), so we pin the commit we validated.
set -euo pipefail
cd "$(dirname "$0")"

APP_COMMIT="e5b6dbff"
BUILDER_IMAGE="ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools:latest"
OUT="apps/app-1.23.0-dev-flex.elf"

mkdir -p vendor
if [ ! -d vendor/app-ethereum ]; then
  git clone -q https://github.com/LedgerHQ/app-ethereum.git vendor/app-ethereum
fi
(cd vendor/app-ethereum && git checkout -q "$APP_COMMIT" && git submodule update -q --init ethereum-plugin-sdk)

docker run --rm -v "$PWD/vendor/app-ethereum:/app" -w /app "$BUILDER_IMAGE" \
  bash -lc 'make -j8 TARGET=flex BOLOS_SDK=$FLEX_SDK EIP7702_TEST_WHITELIST=1'
cp vendor/app-ethereum/build/flex/bin/app.elf "$OUT"
echo "Built $OUT"
