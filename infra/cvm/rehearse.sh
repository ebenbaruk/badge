#!/usr/bin/env bash
# Boots the CVM compose locally, before spending anything on Phala: first-boot secrets, Postgres, Honcho, the
# enclave behind the gateway's ingress, and the sealed network. The LLM upstream gets a placeholder key, so no call
# is billed (LLM requests are refused upstream; the seed job is therefore not started).
#   infra/cvm/rehearse.sh up      (needs infra/cvm/build-push.sh build and infra/dstack-sim.sh start)
#   infra/cvm/rehearse.sh check   /health, the measurement and an attested channel round trip through the gateway,
#                                 Honcho unreachable from outside
#   infra/cvm/rehearse.sh down    stop and delete the rehearsal volumes
set -euo pipefail

CVM_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$CVM_DIR/../.." && pwd)"
PROJECT="badge-cvm-rehearsal"
ENDPOINT="http://127.0.0.1:18787"
# Not secrets: a key the (pinned) upstream rejects, and placeholder model names.
export PHALA_AI_API_KEY="placeholder-rejected-upstream"
export PHALA_AI_MODEL="rehearsal-model"
export PHALA_AI_EMBEDDING_MODEL="rehearsal-embeddings"

compose() {
  docker compose -p "$PROJECT" -f "$CVM_DIR/compose.yml" -f "$CVM_DIR/rehearsal.override.yml" "$@"
}

die() { echo "rehearse.sh: $*" >&2; exit 1; }

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
    compose up -d --wait database api deriver enclave gateway
    check
    ;;
  check) check ;;
  down) compose down -v ;;
  *) die "usage: $0 up | check | down" ;;
esac
