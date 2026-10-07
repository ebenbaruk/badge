#!/usr/bin/env bash
# Local memory stack (Postgres + Honcho API + deriver + egress gateway).
#   ./stack.sh build          clone Honcho v3.2.2, fetch tiktoken encodings, build the images
#   ./stack.sh up             build if needed, start the stack, mint the admin JWT for the enclave
#   ./stack.sh seed           ingest infra/seed/acme.json and verify recall (idempotent)
#   ./stack.sh logs [svc]     follow logs (api, deriver, gateway, database)
#   ./stack.sh status         containers and the indexed profile
#   ./stack.sh down           stop (data kept)
#   ./stack.sh reset          stop and DELETE the memory (required before switching LLM profile)
#
# Environment:
#   BADGE_LLM_PROFILE   build (default) | phala
#   BADGE_LLM_CHAT_MODEL  optional chat model override for the selected profile
#   BADGE_ENV_FILE      secrets file (default: <repo>/../.env). Only the gateway receives the upstream key.
#   BADGE_STATE_DIR     generated secrets and the admin JWT (default: <repo>/infra/.data, gitignored)
#   BADGE_PLATFORM      e.g. linux/amd64 for the Phala CVM; the images are then tagged with an -amd64 suffix
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$INFRA_DIR/.." && pwd)"
ENV_FILE="${BADGE_ENV_FILE:-$REPO_ROOT/../.env}"
STATE_DIR="${BADGE_STATE_DIR:-$INFRA_DIR/.data}"
PROFILE="${BADGE_LLM_PROFILE:-build}"

HONCHO_TAG="v3.2.2"
HONCHO_REPO="https://github.com/plastic-labs/honcho.git"
VENDOR_DIR="$INFRA_DIR/vendor"
UPSTREAM_IMAGE="badge/honcho-upstream:3.2.2"
HONCHO_IMAGE="badge/honcho:3.2.2"
TIKTOKEN_ENCODINGS=(cl100k_base o200k_base)
PHALA_DEFAULT_EMBEDDING_MODEL="sentence-transformers/all-minilm-l6-v2"
# MiniLM is natively 384-dimensional; the build profile asks OpenAI for the same size so the schema never changes.
EMBEDDING_DIMENSIONS=384
ADMIN_JWT_FILE="$STATE_DIR/honcho-admin.jwt"
INDEX_MARKER="$STATE_DIR/indexed-profile"

die() { echo "stack.sh: $*" >&2; exit 1; }

# Reads one KEY=VALUE from the env file without sourcing it (sourcing would execute arbitrary shell).
env_get() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

require_env() {
  local value
  value="$(env_get "$1")"
  [ -n "$value" ] || die "$1 is missing or empty in $ENV_FILE"
  printf '%s' "$value"
}

# Generated once, kept outside git. Never printed.
ensure_secret() {
  local file="$STATE_DIR/$1"
  if [ ! -s "$file" ]; then
    (umask 077 && openssl rand -hex 32 >"$file")
  fi
  cat "$file"
}

# Exports the variables compose.yml interpolates. With $1 = "lenient" (down, logs, status), missing secrets are
# replaced by placeholders: those commands never start the gateway.
load_config() {
  local mode="${1:-strict}"
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  if [ "$mode" = "lenient" ] && [ ! -r "$ENV_FILE" ]; then
    export BADGE_UPSTREAM_BASE_URL="https://unused.invalid" BADGE_UPSTREAM_HOST="unused.invalid"
    export BADGE_UPSTREAM_API_KEY="unused" BADGE_CHAT_MODEL="unused" BADGE_EMBEDDING_MODEL="unused"
    export BADGE_EMBEDDING_DIMENSIONS="$EMBEDDING_DIMENSIONS" BADGE_EMBEDDING_DIMENSIONS_MODE="never"
    export BADGE_EMBEDDING_MAX_INPUT_TOKENS="256"
  else
    [ -r "$ENV_FILE" ] || die "secrets file not readable: $ENV_FILE (set BADGE_ENV_FILE)"
    case "$PROFILE" in
      build)
        BADGE_UPSTREAM_BASE_URL="$(require_env BUILD_LLM_BASE_URL)"
        BADGE_UPSTREAM_API_KEY="$(require_env BUILD_LLM_API_KEY)"
        BADGE_CHAT_MODEL="${BADGE_LLM_CHAT_MODEL:-$(require_env BUILD_LLM_MODEL)}"
        BADGE_EMBEDDING_MODEL="$(require_env BUILD_EMBEDDING_MODEL)"
        [ "$(require_env BUILD_EMBEDDING_DIMENSIONS)" = "$EMBEDDING_DIMENSIONS" ] ||
          die "BUILD_EMBEDDING_DIMENSIONS must be $EMBEDDING_DIMENSIONS (schema shared with the phala profile)"
        # OpenAI text-embedding-3 is shortened on request: Honcho must always send dimensions=384.
        BADGE_EMBEDDING_DIMENSIONS_MODE="always"
        BADGE_EMBEDDING_MAX_INPUT_TOKENS="8192"
        ;;
      phala)
        BADGE_UPSTREAM_BASE_URL="$(require_env PHALA_AI_BASE_URL)"
        BADGE_UPSTREAM_API_KEY="$(require_env PHALA_AI_API_KEY)"
        BADGE_CHAT_MODEL="${BADGE_LLM_CHAT_MODEL:-$(require_env PHALA_AI_MODEL)}"
        BADGE_EMBEDDING_MODEL="$(env_get PHALA_AI_EMBEDDING_MODEL)"
        BADGE_EMBEDDING_MODEL="${BADGE_EMBEDDING_MODEL:-$PHALA_DEFAULT_EMBEDDING_MODEL}"
        # MiniLM has a fixed size and a 256-token input window; Honcho truncates longer inputs (logged).
        BADGE_EMBEDDING_DIMENSIONS_MODE="never"
        BADGE_EMBEDDING_MAX_INPUT_TOKENS="256"
        ;;
      *) die "unknown BADGE_LLM_PROFILE '$PROFILE' (build | phala)" ;;
    esac
    BADGE_UPSTREAM_BASE_URL="${BADGE_UPSTREAM_BASE_URL%/}"
    case "$BADGE_UPSTREAM_BASE_URL" in
      https://*) ;;
      *) die "the upstream base URL must use https" ;;
    esac
    BADGE_UPSTREAM_HOST="${BADGE_UPSTREAM_BASE_URL#https://}"
    BADGE_UPSTREAM_HOST="${BADGE_UPSTREAM_HOST%%/*}"
    export BADGE_UPSTREAM_BASE_URL BADGE_UPSTREAM_HOST BADGE_UPSTREAM_API_KEY BADGE_CHAT_MODEL
    export BADGE_EMBEDDING_MODEL BADGE_EMBEDDING_DIMENSIONS_MODE BADGE_EMBEDDING_MAX_INPUT_TOKENS
    export BADGE_EMBEDDING_DIMENSIONS="$EMBEDDING_DIMENSIONS"
  fi
  BADGE_HONCHO_JWT_SECRET="$(ensure_secret honcho-jwt-secret)"
  BADGE_DB_PASSWORD="$(ensure_secret db-password)"
  export BADGE_HONCHO_JWT_SECRET BADGE_DB_PASSWORD
}

compose() { docker compose -f "$INFRA_DIR/compose.yml" "$@"; }

image_suffix() { [ -n "${BADGE_PLATFORM:-}" ] && printf -- '-%s' "${BADGE_PLATFORM##*/}" || true; }

fetch_vendor() {
  mkdir -p "$VENDOR_DIR"
  [ -d "$VENDOR_DIR/honcho" ] ||
    git -c advice.detachedHead=false clone -q --depth 1 --branch "$HONCHO_TAG" "$HONCHO_REPO" "$VENDOR_DIR/honcho"
  mkdir -p "$VENDOR_DIR/tiktoken"
  local enc url name
  for enc in "${TIKTOKEN_ENCODINGS[@]}"; do
    url="https://openaipublic.blob.core.windows.net/encodings/$enc.tiktoken"
    name="$(printf '%s' "$url" | shasum -a 1 | cut -d' ' -f1)"
    [ -s "$VENDOR_DIR/tiktoken/$name" ] || curl -fsSL -o "$VENDOR_DIR/tiktoken/$name" "$url"
  done
}

build_images() {
  local suffix platform_args=()
  suffix="$(image_suffix)"
  [ -n "${BADGE_PLATFORM:-}" ] && platform_args=(--platform "$BADGE_PLATFORM")
  fetch_vendor
  echo "building $UPSTREAM_IMAGE$suffix"
  docker build -q ${platform_args[@]+"${platform_args[@]}"} -t "$UPSTREAM_IMAGE$suffix" "$VENDOR_DIR/honcho" >/dev/null
  echo "building $HONCHO_IMAGE$suffix"
  docker build -q ${platform_args[@]+"${platform_args[@]}"} -t "$HONCHO_IMAGE$suffix" \
    --build-context "upstream=docker-image://$UPSTREAM_IMAGE$suffix" \
    --build-context "tiktoken=$VENDOR_DIR/tiktoken" \
    "$INFRA_DIR/honcho" >/dev/null
}

# Embeddings from two profiles live in different vector spaces even at the same size: mixing them silently
# ruins recall. The marker records which profile indexed the current database.
check_index_marker() {
  local signature="$PROFILE:$BADGE_EMBEDDING_MODEL"
  if [ -s "$INDEX_MARKER" ] && [ "$(cat "$INDEX_MARKER")" != "$signature" ]; then
    die "memory was indexed with '$(cat "$INDEX_MARKER")', not '$signature'. Run ./stack.sh reset, then up and seed."
  fi
  printf '%s' "$signature" >"$INDEX_MARKER"
}

mint_admin_jwt() {
  local token
  # Run through bash with explicit arguments: zsh word-splitting once produced malformed JWT claims.
  token="$(compose exec -T api /app/.venv/bin/python scripts/generate_jwt.py --admin 2>/dev/null |
    grep -oE 'ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' | head -n 1 || true)"
  [ -n "$token" ] || die "could not mint the Honcho admin JWT"
  (umask 077 && printf '%s' "$token" >"$ADMIN_JWT_FILE")
  echo "admin JWT written to $ADMIN_JWT_FILE"
}

cmd="${1:-up}"
case "$cmd" in
  build)
    build_images
    ;;
  up)
    docker info >/dev/null 2>&1 || die "Docker is not running"
    load_config
    docker image inspect "$HONCHO_IMAGE" >/dev/null 2>&1 || build_images
    check_index_marker
    compose up -d --wait
    mint_admin_jwt
    echo "Honcho API on http://127.0.0.1:8000 (profile $PROFILE, chat model $BADGE_CHAT_MODEL)"
    ;;
  seed)
    [ -s "$ADMIN_JWT_FILE" ] || die "no admin JWT: run ./stack.sh up first"
    load_config
    check_index_marker
    BADGE_HONCHO_JWT_FILE="$ADMIN_JWT_FILE" BADGE_ENV_FILE="$ENV_FILE" BADGE_LLM_PROFILE="$PROFILE" \
      pnpm --dir "$REPO_ROOT" exec tsx infra/seed/seed.ts
    ;;
  logs)
    load_config lenient
    compose logs -f --tail 200 "${@:2}"
    ;;
  status)
    load_config lenient
    compose ps
    [ -s "$INDEX_MARKER" ] && echo "indexed with: $(cat "$INDEX_MARKER")" || echo "not indexed yet"
    ;;
  down)
    load_config lenient
    compose down
    ;;
  reset)
    load_config lenient
    compose down -v
    rm -f "$INDEX_MARKER" "$ADMIN_JWT_FILE"
    echo "memory deleted"
    ;;
  *)
    die "unknown command '$cmd' (build | up | seed | logs | status | down | reset)"
    ;;
esac
