#!/usr/bin/env bash
# Read-only: authentication, the account's CVMs (anything listed may be billing), and when Badge is deployed its
# details, containers, and the enclave's health and measurement compared with the pinned compose hash.
set -euo pipefail
# shellcheck source=cvm/phala-common.sh
. "$(dirname "$0")/cvm/phala-common.sh"

require_tools
phala_auth
echo "== account"
phala whoami
echo
echo "== CVMs (every listed CVM may be billing)"
phala cvms list

if ! cvm_exists "$CVM_NAME"; then
  echo
  echo "Badge ('$CVM_NAME') is not deployed."
  exit 0
fi

ref="$(cvm_ref)"
echo
echo "== $ref"
phala cvms get "$ref"
echo
echo "== containers"
# With --no-public-sysinfo this may be refused; the health check below does not depend on it.
phala ps "$ref" || echo "(container list unavailable)"

if [ -s "$ENDPOINT_FILE" ]; then
  endpoint="$(cat "$ENDPOINT_FILE")"
  echo
  echo "== enclave $endpoint"
  if health="$(curl -fsS -m 10 "$endpoint/health" 2>/dev/null)"; then
    echo "health: $health"
    measurement="$(curl -fsS -m 10 "$endpoint/v1/attestation/measurement" | jq -r .measurement)"
    echo "measurement: $measurement"
    if [ -s "$EXPECTED_HASH_FILE" ]; then
      [ "$measurement" = "0x$(cat "$EXPECTED_HASH_FILE")" ] && echo "matches the pinned compose hash" ||
        echo "DOES NOT match the pinned compose hash ($EXPECTED_HASH_FILE)"
    fi
  else
    echo "health: unreachable"
  fi
fi
