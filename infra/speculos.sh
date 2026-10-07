#!/usr/bin/env bash
# Runs 3 emulated Ledger Flex devices (Speculos), one per demo employee.
#   ./speculos.sh          start alice (5001), bob (5002), chloe (5003)
#   ./speculos.sh stop     remove all three
# ETH_APP=release uses the published 1.22.3 app (no contact names) instead of the develop build.
# TEST seeds only: public mnemonics, never hold funds.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${ETH_APP:-develop}" = "release" ]; then ELF="app-1.22.3-flex.elf"; else ELF="app-1.23.0-dev-flex.elf"; fi
NAMES=(alice bob chloe)
PORTS=(5001 5002 5003)
SEEDS=(
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  "legal winner thank year wave sausage worth useful legal winner thank yellow"
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"
)

if [ "${1:-start}" = "stop" ]; then
  for n in "${NAMES[@]}"; do docker rm -f "speculos-$n" >/dev/null 2>&1 || true; done
  exit 0
fi

[ -s "apps/$ELF" ] || { echo "Missing apps/$ELF (run ./setup.sh or ./build-eth-app.sh)"; exit 1; }
for i in 0 1 2; do
  n=${NAMES[$i]}; p=${PORTS[$i]}
  docker rm -f "speculos-$n" >/dev/null 2>&1 || true
  docker run -d --name "speculos-$n" -v "$PWD/apps:/speculos/apps" -p "$p:5000" \
    ghcr.io/ledgerhq/speculos:latest \
    --model flex --display headless --api-port 5000 --seed "${SEEDS[$i]}" "apps/$ELF" >/dev/null
  echo "$n -> http://localhost:$p ($ELF)"
done
