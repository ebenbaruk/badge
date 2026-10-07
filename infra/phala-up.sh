#!/usr/bin/env bash
# Deploys Badge to a Phala Cloud CVM (Intel TDX). THIS COSTS MONEY from the moment it runs until
# infra/phala-down.sh: it refuses to run unless PHALA_CONFIRM_SPEND=yes.
#
#   PHALA_CONFIRM_SPEND=yes infra/phala-up.sh
#
# Steps: checks (digests pinned, compose committed, no CVM of that name already), deploy with the confidentiality
# flags, record the app id and endpoint, capture the pins (infra/cvm/expected-compose-hash.txt and
# expected-measurements.json, via infra/cvm/pin-measurements.ts), wait for the enclave /health.
#
# Environment:
#   BADGE_CVM_NAME            CVM name (default: badge)
#   BADGE_PHALA_INSTANCE_TYPE default tdx.medium (2 vCPU, 4 GB): the stack holds ~0.9 GB at rest (Postgres, Honcho
#                             API + deriver, enclave, nginx) on top of the dstack OS and Docker; tdx.small (2 GB)
#                             leaves no margin for image pulls and the deriver's peaks.
#   BADGE_PHALA_DISK_SIZE     default 20G (images ~1.5 GB, memory database a few MB)
#   BADGE_ENV_FILE            secrets file (default <repo>/../.env): PHALA_AI_API_KEY, PHALA_AI_MODEL, optional
#                             PHALA_AI_EMBEDDING_MODEL, PHALA_CLOUD_API_KEY. The LLM endpoint is not configurable:
#                             it is pinned in compose.yml and in the gateway image (attested).
set -euo pipefail
# shellcheck source=cvm/phala-common.sh
. "$(dirname "$0")/cvm/phala-common.sh"

INSTANCE_TYPE="${BADGE_PHALA_INSTANCE_TYPE:-tdx.medium}"
DISK_SIZE="${BADGE_PHALA_DISK_SIZE:-20G}"
DEFAULT_EMBEDDING_MODEL="sentence-transformers/all-minilm-l6-v2"
ATTESTATION_TIMEOUT_S=600
HEALTH_TIMEOUT_S=900
POLL_S=10

[ "${PHALA_CONFIRM_SPEND:-}" = "yes" ] ||
  die "this starts a billed CVM ($INSTANCE_TYPE). Re-run with PHALA_CONFIRM_SPEND=yes once the spend is approved."
require_tools pnpm git

# --- 1. The compose file must be the exact, committed, fully pinned code -----------------------------------
grep -Eq '@sha256:0{64}' "$COMPOSE_FILE" && die "placeholder digests in $COMPOSE_FILE: run infra/cvm/build-push.sh push"
unpinned="$(grep -E '^\s+image:' "$COMPOSE_FILE" | grep -v '@sha256:[0-9a-f]\{64\}' || true)"
[ -z "$unpinned" ] || die "images not pinned by digest: $unpinned"
if [ -n "$(git -C "$REPO_ROOT" status --porcelain -- "$COMPOSE_FILE")" ] && [ "${BADGE_ALLOW_DIRTY:-}" != "1" ]; then
  die "commit $COMPOSE_FILE first: the clients pin the hash of the committed file"
fi

# --- 2. Secrets for the CVM: only the three PHALA_AI_* variables, never the whole env file --------------------
# No endpoint among them: an encrypted variable is the deployer's choice outside the compose hash, so the LLM
# upstream is a literal of the attested compose and gateway image (clients reject an endpoint in allowed_envs).
[ -r "$ENV_FILE" ] || die "secrets file not readable: $ENV_FILE (set BADGE_ENV_FILE)"
api_key="$(env_get PHALA_AI_API_KEY)"
model="$(env_get PHALA_AI_MODEL)"
embedding_model="$(env_get PHALA_AI_EMBEDDING_MODEL)"
embedding_model="${embedding_model:-$DEFAULT_EMBEDDING_MODEL}"
[ -n "$api_key" ] && [ -n "$model" ] || die "PHALA_AI_API_KEY and PHALA_AI_MODEL are required in $ENV_FILE"

phala_auth
cvm_exists "$CVM_NAME" && die "a CVM named '$CVM_NAME' already exists: infra/phala-status.sh, or infra/phala-down.sh first"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
secrets_file="$(umask 077 && mktemp "$STATE_DIR/deploy-env.XXXXXX")"
trap 'rm -f "$secrets_file"' EXIT
# The CLI encrypts these locally to the CVM's KMS key; the variable NAMES become `allowed_envs` (part of the hash).
{
  printf 'PHALA_AI_API_KEY=%s\n' "$api_key"
  printf 'PHALA_AI_MODEL=%s\n' "$model"
  printf 'PHALA_AI_EMBEDDING_MODEL=%s\n' "$embedding_model"
} >"$secrets_file"

# --- 3. Deploy ---------------------------------------------------------------------------------------------------
echo "deploying '$CVM_NAME' ($INSTANCE_TYPE, disk $DISK_SIZE, KMS phala). Billing starts now."
deployed=0
on_failure() {
  rm -f "$secrets_file"
  if [ "$deployed" = "1" ]; then
    echo "phala-up.sh failed AFTER the deployment: the CVM is running and billed. Stop it: infra/phala-down.sh" >&2
  fi
}
trap on_failure EXIT
# --no-dev-os: production OS image (no SSH, no debug); --no-public-logs / --no-public-sysinfo: the platform must
# not publish container logs or system info (default true); --public-tcbinfo: lets anyone fetch app-compose and the
# event log to verify us; --no-listed: not on the public Trust Center listing.
phala deploy --json --wait \
  --name "$CVM_NAME" \
  --compose "$COMPOSE_FILE" \
  --instance-type "$INSTANCE_TYPE" \
  --disk-size "$DISK_SIZE" \
  --kms phala \
  --no-dev-os --no-public-logs --no-public-sysinfo --public-tcbinfo --no-listed \
  -e "$secrets_file" >"$STATE_DIR/deploy.raw"
# The CLI prints progress lines ("Provisioning CVM ...") before the JSON document even with --json.
sed -n '/^{/,$p' "$STATE_DIR/deploy.raw" >"$STATE_DIR/deploy.json"
deployed=1
rm -f "$secrets_file"

app_id="$(jq -r '[.. | objects | .app_id? // empty | strings][0] // empty' "$STATE_DIR/deploy.json")"
[ -n "$app_id" ] || die "no app_id in the deploy output ($STATE_DIR/deploy.json)"
printf '%s' "$app_id" >"$APP_ID_FILE"
echo "app id: $app_id"

# --- 4. Pins: compose hash and OS measurements, from the running CVM --------------------------------------------
deadline=$((SECONDS + ATTESTATION_TIMEOUT_S))
until phala cvms attestation "$app_id" --json >"$STATE_DIR/attestation.json" 2>/dev/null &&
  jq -e '[.. | objects | select(has("app_compose"))] | length > 0' "$STATE_DIR/attestation.json" >/dev/null; do
  [ "$SECONDS" -lt "$deadline" ] || die "no attestation after ${ATTESTATION_TIMEOUT_S}s (infra/phala-status.sh)"
  sleep "$POLL_S"
done
pnpm --dir "$REPO_ROOT" exec tsx infra/cvm/pin-measurements.ts "$STATE_DIR/attestation.json"

# --- 5. Endpoint and health ----------------------------------------------------------------------------------------
phala cvms get "$app_id" --json | sed -n '/^{/,$p' >"$STATE_DIR/cvm.json"
# The CVM lists its public app URLs (https://<app-id>-<port>.<cluster domain>); other URLs of the response (KMS,
# logs) can live on a different cluster, so select the enclave port URL of this app id explicitly.
endpoint="$(jq -r --arg prefix "https://${app_id#0x}-$ENCLAVE_PORT." \
  '[.. | strings | select(startswith($prefix))][0] // empty' "$STATE_DIR/cvm.json" | sed -E 's#/+$##')"
[ -n "$endpoint" ] || die "no public URL for port $ENCLAVE_PORT in $STATE_DIR/cvm.json"
printf '%s' "$endpoint" >"$ENDPOINT_FILE"
echo "endpoint: $endpoint"

deadline=$((SECONDS + HEALTH_TIMEOUT_S))
until curl -fsS -m 10 "$endpoint/health" >/dev/null 2>&1; do
  [ "$SECONDS" -lt "$deadline" ] || die "enclave not healthy after ${HEALTH_TIMEOUT_S}s at $endpoint"
  sleep "$POLL_S"
done
measurement="$(curl -fsS -m 10 "$endpoint/v1/attestation/measurement" | jq -r .measurement)"
expected="0x$(cat "$EXPECTED_HASH_FILE")"
[ "$measurement" = "$expected" ] || die "the enclave reports measurement $measurement, the pinned hash is $expected"

trap - EXIT
echo
echo "Badge is up: $endpoint (measurement $measurement)"
echo "Pins: $EXPECTED_HASH_FILE and infra/cvm/expected-measurements.json (commit them for the clients)."
echo "The CVM is billed until: infra/phala-down.sh"
