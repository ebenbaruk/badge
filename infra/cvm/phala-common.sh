#!/usr/bin/env bash
# Shared by infra/phala-up.sh, phala-down.sh and phala-status.sh (sourced, not executed).
# Flags and subcommands checked against `phala --help` of CLI v1.1.22.

CVM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$CVM_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INFRA_DIR/.." && pwd)"
ENV_FILE="${BADGE_ENV_FILE:-$REPO_ROOT/../.env}"
COMPOSE_FILE="$CVM_DIR/compose.yml"
EXPECTED_HASH_FILE="$CVM_DIR/expected-compose-hash.txt"
# Deployment state (app id, raw CLI outputs): gitignored, never contains a secret.
STATE_DIR="${BADGE_CVM_STATE_DIR:-$INFRA_DIR/.data/cvm}"
APP_ID_FILE="$STATE_DIR/app-id"
ENDPOINT_FILE="$STATE_DIR/endpoint"
CVM_NAME="${BADGE_CVM_NAME:-badge}"
# The only port published by the CVM (gateway -> enclave), see infra/cvm/compose.yml.
ENCLAVE_PORT=8787

die() { echo "$(basename "$0"): $*" >&2; exit 1; }

require_tools() {
  local tool
  for tool in phala jq curl "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
  done
}

# Reads one KEY=VALUE from the env file without sourcing it (sourcing would execute arbitrary shell).
env_get() {
  local line
  [ -r "$ENV_FILE" ] || { printf ''; return 0; }
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

# The CLI reads PHALA_CLOUD_API_KEY from the environment (never pass it as an argument: it would show in `ps`).
phala_auth() {
  if [ -z "${PHALA_CLOUD_API_KEY:-}" ]; then
    PHALA_CLOUD_API_KEY="$(env_get PHALA_CLOUD_API_KEY)"
    [ -n "$PHALA_CLOUD_API_KEY" ] || unset PHALA_CLOUD_API_KEY
  fi
  [ -n "${PHALA_CLOUD_API_KEY:-}" ] && export PHALA_CLOUD_API_KEY
  export PHALA_DISABLE_UPDATE_CHECK=1
  phala whoami >/dev/null 2>&1 || die "not authenticated with Phala Cloud (PHALA_CLOUD_API_KEY in $ENV_FILE, or phala login)"
}

# The CVM to act on: the recorded app id, else the name.
cvm_ref() {
  if [ -s "$APP_ID_FILE" ]; then cat "$APP_ID_FILE"; else printf '%s' "$CVM_NAME"; fi
}

# True when the account has a CVM named $1 (any status). The JSON shape of `cvms list` is not documented, so the
# name is searched in every object of the response.
cvm_exists() {
  local list
  # A failed listing must not read as "no CVM": phala-up would then start a second, billed one.
  list="$(phala cvms list --json)" || die "cannot list the CVMs"
  jq -e --arg name "$1" '[.. | objects | select(.name? == $name)] | length > 0' <<<"$list" >/dev/null
}
