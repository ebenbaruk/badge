#!/usr/bin/env bash
# Runs 5 emulated Ledger Flex devices (Speculos), one per demo employee.
#   ./speculos.sh          start alice (5001), bob (5002), chloe (5003), david (5004), emma (5005)
#   ./speculos.sh stop     remove all of them
# David and Emma are the other members of the Research desk: they join it with their own Ledger (DeskJoin), so the
# desk's anonymity set is made of real Ledger holders only (pnpm demo does it, or pnpm desks:seed before the web
# demo).
# ETH_APP=release uses the published 1.22.3 app (no contact names) instead of the develop build.
# TEST seeds only: public BIP-39 test-vector mnemonics, never hold funds. Account 0 (m/44'/60'/0'/0/0) addresses:
#   alice 0x9858EfFD232B4033E47d90003D41EC34EcaEda94   bob   0x58A57ed9d8d624cBD12e2C467D34787555bB1b25
#   chloe 0x3061750d3dF69ef7B8d4407CB7f3F879Fd9d2398   david 0xfc2077CA7F403cBECA41B1B0F62D91B5EA631B5E
#   emma  0xc70eC8094CCE52B6574A5a2b7bf0c7D8288d77cC   (infra/seed/acme.json must list the same addresses)
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=speculos-image.sh
. ./speculos-image.sh

if [ "${ETH_APP:-develop}" = "release" ]; then ELF="app-1.22.3-flex.elf"; else ELF="app-1.23.0-dev-flex.elf"; fi
NAMES=(alice bob chloe david emma)
PORTS=(5001 5002 5003 5004 5005)
SEEDS=(
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  "legal winner thank year wave sausage worth useful legal winner thank yellow"
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"
  "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"
  "scheme spot photo card baby mountain device kick cradle pact join borrow"
)

if [ "${1:-start}" = "stop" ]; then
  for n in "${NAMES[@]}"; do docker rm -f "speculos-$n" >/dev/null 2>&1 || true; done
  exit 0
fi

[ -s "apps/$ELF" ] || { echo "Missing apps/$ELF (run ./setup.sh or ./build-eth-app.sh)"; exit 1; }
for i in "${!NAMES[@]}"; do
  n=${NAMES[$i]}; p=${PORTS[$i]}
  docker rm -f "speculos-$n" >/dev/null 2>&1 || true
  docker run -d --name "speculos-$n" -v "$PWD/apps:/speculos/apps" -p "$p:5000" \
    "$SPECULOS_IMAGE" \
    --model flex --display headless --api-port 5000 --seed "${SEEDS[$i]}" "apps/$ELF" >/dev/null
  echo "$n -> http://localhost:$p ($ELF)"
done
