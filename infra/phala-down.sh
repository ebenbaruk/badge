#!/usr/bin/env bash
# Stops AND deletes the Badge CVM, so that nothing keeps billing (a stopped CVM still pays for its disk).
# Deleting erases the CVM's encrypted disk: the memory, the enclave database and the in-CVM secrets are gone, and a
# new deployment gets a new app id, hence new pins. That is the intended lifecycle between demo sessions.
#
#   infra/phala-down.sh            the CVM recorded by phala-up.sh, else the one named $BADGE_CVM_NAME (badge)
set -euo pipefail
# shellcheck source=cvm/phala-common.sh
. "$(dirname "$0")/cvm/phala-common.sh"

require_tools
phala_auth
ref="$(cvm_ref)"

if ! cvm_exists "$CVM_NAME" && [ ! -s "$APP_ID_FILE" ]; then
  echo "no CVM named '$CVM_NAME': nothing is billed"
  exit 0
fi

echo "stopping $ref"
# An already stopped CVM makes `stop` fail: deleting is what matters, so carry on.
phala cvms stop "$ref" || echo "stop failed or CVM already stopped, deleting anyway" >&2
echo "deleting $ref"
phala cvms delete "$ref" --yes

if cvm_exists "$CVM_NAME"; then
  die "'$CVM_NAME' is still listed after delete: check the dashboard (it may still be billing)"
fi
rm -f "$APP_ID_FILE" "$ENDPOINT_FILE"
echo "CVM deleted: nothing is billed any more"
