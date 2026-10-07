#!/usr/bin/env bash
# Boots the CVM compose locally, before spending anything on Phala: first-boot secrets, Postgres, Honcho, the
# enclave behind the gateway's ingress, and the sealed network. By default the LLM upstream gets a placeholder key,
# so no call is billed (LLM requests are refused upstream; the seed job is therefore not started).
#   infra/cvm/rehearse.sh up      (needs infra/cvm/build-push.sh build and infra/dstack-sim.sh start)
#   infra/cvm/rehearse.sh up --real-llm
#                                 same, with the real Phala Confidential AI key and models read from BADGE_ENV_FILE
#                                 (default <repo>/../.env), then the seed job: the CVM exactly as deployed, except
#                                 that its logs are readable (`compose logs`). BILLED: every LLM call costs a little.
#   infra/cvm/rehearse.sh check   /health, the measurement and an attested channel round trip through the gateway,
#                                 Honcho unreachable from outside
#   infra/cvm/rehearse.sh down    stop and delete the rehearsal volumes
set -euo pipefail

CVM_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$CVM_DIR/../.." && pwd)"
PROJECT="badge-cvm-rehearsal"
ENDPOINT="http://127.0.0.1:18787"
ENV_FILE="${BADGE_ENV_FILE:-$REPO_ROOT/../.env}"
# Same default as infra/phala-up.sh (the CVM receives exactly these three values).
DEFAULT_EMBEDDING_MODEL="sentence-transformers/all-minilm-l6-v2"

compose() {
  docker compose -p "$PROJECT" -f "$CVM_DIR/compose.yml" -f "$CVM_DIR/rehearsal.override.yml" "$@"
}

die() { echo "rehearse.sh: $*" >&2; exit 1; }

# Reads one KEY=VALUE from the env file without sourcing it (sourcing would execute arbitrary shell).
env_get() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

# Not secrets: a key the (pinned) upstream rejects, and placeholder model names. Also what `check` and `down` use:
# compose only needs the variables to be set.
placeholder_llm() {
  export PHALA_AI_API_KEY="placeholder-rejected-upstream"
  export PHALA_AI_MODEL="rehearsal-model"
  export PHALA_AI_EMBEDDING_MODEL="rehearsal-embeddings"
}

# The values phala-up.sh would encrypt for the CVM. Exported for docker compose only, never printed.
real_llm() {
  [ -r "$ENV_FILE" ] || die "secrets file not readable: $ENV_FILE (set BADGE_ENV_FILE)"
  PHALA_AI_API_KEY="$(env_get PHALA_AI_API_KEY)"
  PHALA_AI_MODEL="$(env_get PHALA_AI_MODEL)"
  PHALA_AI_EMBEDDING_MODEL="$(env_get PHALA_AI_EMBEDDING_MODEL)"
  PHALA_AI_EMBEDDING_MODEL="${PHALA_AI_EMBEDDING_MODEL:-$DEFAULT_EMBEDDING_MODEL}"
  [ -n "$PHALA_AI_API_KEY" ] && [ -n "$PHALA_AI_MODEL" ] || die "PHALA_AI_API_KEY and PHALA_AI_MODEL are required in $ENV_FILE"
  export PHALA_AI_API_KEY PHALA_AI_MODEL PHALA_AI_EMBEDDING_MODEL
  echo "real LLM: chat $PHALA_AI_MODEL, embeddings $PHALA_AI_EMBEDDING_MODEL (calls are billed)"
}

# Runs the seed job to completion, as at the CVM's first boot, and fails if it does.
seed() {
  local container status
  compose up -d --no-deps seed
  container="$(compose ps -a -q seed)"
  [ -n "$container" ] || die "seed container not found"
  status="$(docker wait "$container")"
  compose logs --no-log-prefix seed
  [ "$status" = "0" ] || die "seed job exited with status $status"
}

check() {
  local health measurement
  health="$(curl -fsS "$ENDPOINT/health")" || die "enclave /health unreachable through the gateway"
  echo "health: $health"
  measurement="$(curl -fsS "$ENDPOINT/v1/attestation/measurement")" || die "measurement unreachable"
  echo "measurement: $measurement"
  # The quote is verified against the simulator, then a request goes through the channel and back.
  (cd "$REPO_ROOT" && pnpm exec tsx infra/cvm/check-channel.ts "$ENDPOINT" simulated) ||
    die "attested channel through the gateway failed"
  # Plain HTTP must not reach the API: TLS ends at the Phala gateway, only the channel is confidential.
  local plain_status
  plain_status="$(curl -sS -o /dev/null -w '%{http_code}' "$ENDPOINT/v1/me")"
  [ "$plain_status" = "403" ] || die "plain HTTP /v1/me answered $plain_status instead of 403 (channel required)"
  echo "plain HTTP on /v1: refused (403, attested channel required)"
  # Only the enclave port is published: Honcho and Postgres have no host port at all.
  local published
  published="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Ports}}' |
    grep -- '->' | grep -v -- '-gateway-' || true)"
  [ -z "$published" ] || die "a port other than the gateway's is published: $published"
  # The sealed network has no route out (Honcho cannot reach anything but the gateway).
  if compose exec -T api /app/.venv/bin/python -c \
    "import urllib.request; urllib.request.urlopen('https://example.com', timeout=5)" >/dev/null 2>&1; then
    die "Honcho reached the internet: the sealed network is not sealed"
  fi
  echo "sealed network: Honcho has no route out; only the enclave port is published"
}

case "${1:-}" in
  up)
    case "${2:-}" in
      "") placeholder_llm ;;
      --real-llm) real_llm ;;
      *) die "usage: $0 up [--real-llm]" ;;
    esac
    compose up -d --wait database api deriver enclave gateway
    check
    if [ "${2:-}" = "--real-llm" ]; then seed; fi
    ;;
  check) placeholder_llm; check ;;
  down) placeholder_llm; compose down -v ;;
  *) die "usage: $0 up [--real-llm] | check | down" ;;
esac
