#!/usr/bin/env bash
# One command to get the local Badge stack ready for the demo:
#   prerequisites -> pnpm install -> infra/setup.sh -> 5 Speculos Ledgers -> dstack simulator
#   -> memory stack (Postgres, Honcho, egress gateway) -> seed of the demo dataset.
#
#   scripts/bootstrap.sh              everything
#   scripts/bootstrap.sh --skip-seed  everything but the seed (the seed makes a few cents of LLM calls)
#
# Idempotent: every step is skipped or is a no-op when already done, running Speculos devices are left untouched.
# Never prints a secret: the secrets file is only checked for the presence of variable names.
#
# Environment (same as infra/stack.sh): BADGE_ENV_FILE (default <repo>/.env if present, else <repo>/../.env), BADGE_LLM_PROFILE (build | phala).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFRA_DIR="$REPO_ROOT/infra"
# A .env at the repository root (gitignored) wins over the historical ../.env next to the repository.
if [ -z "${BADGE_ENV_FILE:-}" ] && [ -f "$REPO_ROOT/.env" ]; then ENV_FILE="$REPO_ROOT/.env"
else ENV_FILE="${BADGE_ENV_FILE:-$REPO_ROOT/../.env}"; fi
PROFILE="${BADGE_LLM_PROFILE:-build}"

MIN_NODE_MAJOR=24
MIN_PNPM_MAJOR=11
DEVELOP_ELF="$INFRA_DIR/apps/app-1.23.0-dev-flex.elf"
SPECULOS_NAMES=(alice bob chloe david emma)
SPECULOS_PORTS=(5001 5002 5003 5004 5005)
HONCHO_IMAGE="badge/honcho:3.2.2" # built by infra/stack.sh

SKIP_SEED=false
for arg in "$@"; do
  case "$arg" in
    --skip-seed) SKIP_SEED=true ;;
    -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "bootstrap.sh: unknown option '$arg' (--skip-seed | --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then BOLD=$'\e[1m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'
else BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""; fi

step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
ok() { printf '%s  ok%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s  !!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die() { printf '%s  xx %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

major_of() { printf '%s' "$1" | sed -E 's/^v//; s/\..*$//'; }

# Variable names each LLM profile needs (infra/stack.sh reads the values; this script never does).
required_env_names() {
  case "$PROFILE" in
    build) echo "BUILD_LLM_BASE_URL BUILD_LLM_API_KEY BUILD_LLM_MODEL BUILD_EMBEDDING_MODEL BUILD_EMBEDDING_DIMENSIONS" ;;
    phala) echo "PHALA_AI_BASE_URL PHALA_AI_API_KEY PHALA_AI_MODEL" ;;
    *) die "unknown BADGE_LLM_PROFILE '$PROFILE' (build | phala)" ;;
  esac
}

check_prerequisites() {
  step "Prerequisites"
  local cmd
  for cmd in docker node pnpm curl git openssl; do
    command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' not found in PATH"
  done
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || die "neither sha256sum nor shasum found"

  local node_version pnpm_version
  node_version="$(node --version)"
  [ "$(major_of "$node_version")" -ge "$MIN_NODE_MAJOR" ] || die "Node $MIN_NODE_MAJOR+ required (found $node_version)"
  ok "Node $node_version"
  pnpm_version="$(pnpm --version)"
  [ "$(major_of "$pnpm_version")" -ge "$MIN_PNPM_MAJOR" ] || die "pnpm $MIN_PNPM_MAJOR+ required (found $pnpm_version)"
  ok "pnpm $pnpm_version"

  docker info >/dev/null 2>&1 || die "Docker is not running (macOS: open -a Docker)"
  docker compose version >/dev/null 2>&1 || die "the Docker Compose plugin is missing"
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo running)"

  [ -r "$ENV_FILE" ] || die "secrets file not readable: $ENV_FILE (copy .env.example there and fill it, or set BADGE_ENV_FILE)"
  local name missing=()
  for name in $(required_env_names); do
    grep -qE "^${name}=.+" "$ENV_FILE" || missing+=("$name")
  done
  [ "${#missing[@]}" -eq 0 ] || die "missing or empty in $ENV_FILE for profile '$PROFILE': ${missing[*]}"
  local mode
  mode="$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")"
  [ "$mode" = "600" ] || warn "$ENV_FILE has mode $mode; chmod 600 recommended"
  ok "secrets file present, profile '$PROFILE' complete (values not read)"
}

install_dependencies() {
  step "Dependencies (pnpm install)"
  (cd "$REPO_ROOT" && pnpm install --frozen-lockfile --reporter=silent)
  ok "workspace installed"
}

fetch_artifacts() {
  step "Artifacts: Speculos image, Ethereum app, Semaphore circuits, test CAL key (infra/setup.sh)"
  "$INFRA_DIR/setup.sh" | sed 's/^/  /'
}

speculos_running() {
  local i
  for i in "${!SPECULOS_NAMES[@]}"; do
    [ "$(docker inspect -f '{{.State.Running}}' "speculos-${SPECULOS_NAMES[$i]}" 2>/dev/null)" = "true" ] || return 1
    curl -fsS -o /dev/null "http://localhost:${SPECULOS_PORTS[$i]}/events" || return 1
  done
}

start_speculos() {
  step "Ledgers: 5 Speculos Flex (alice :5001, bob :5002, chloe :5003, david :5004, emma :5005)"
  if speculos_running; then
    ok "already running, left untouched (infra/speculos.sh to restart them)"
    return
  fi
  if [ -s "$DEVELOP_ELF" ]; then
    "$INFRA_DIR/speculos.sh" | sed 's/^/  /'
  else
    warn "develop Ethereum app not built: using the 1.22.3 release (no address-book contact names)."
    warn "Build it once with infra/build-eth-app.sh (Docker, a few minutes) to enable them."
    ETH_APP=release "$INFRA_DIR/speculos.sh" | sed 's/^/  /'
  fi
}

start_dstack_simulator() {
  step "Simulated TEE: dstack simulator (:8090)"
  "$INFRA_DIR/dstack-sim.sh" start | sed 's/^/  /'
}

start_memory_stack() {
  step "Memory: Postgres + Honcho + egress gateway (infra/stack.sh up, profile '$PROFILE')"
  docker image inspect "$HONCHO_IMAGE" >/dev/null 2>&1 || warn "first run: building the Honcho images takes several minutes"
  BADGE_ENV_FILE="$ENV_FILE" BADGE_LLM_PROFILE="$PROFILE" "$INFRA_DIR/stack.sh" up | sed 's/^/  /'
  if [ "$SKIP_SEED" = true ]; then
    warn "seed skipped (--skip-seed): run infra/stack.sh seed before the demo"
    return
  fi
  step "Demo dataset: seed and recall checks (infra/stack.sh seed, idempotent)"
  BADGE_ENV_FILE="$ENV_FILE" BADGE_LLM_PROFILE="$PROFILE" "$INFRA_DIR/stack.sh" seed | sed 's/^/  /'
}

print_next_steps() {
  step "Ready"
  cat <<EOF
  Scripted end-to-end demo (starts its own enclave on a fresh database, drives the 5 Ledgers):
    pnpm demo
    # if an enclave already listens on :8787 (web walk-through): BADGE_DEMO_ENCLAVE_PORT=8788 pnpm demo

  Web demo, prepared (enrollments, agent sessions, desks), then open http://localhost:3000/demo:
    pnpm demo:web            # --fresh for a clean run, --rehearsal for "Auto review", stop | status | logs

  Walkthrough and troubleshooting: INSTALL.md
  Stop everything: pnpm demo:web stop && infra/speculos.sh stop && infra/dstack-sim.sh stop && infra/stack.sh down
EOF
}

check_prerequisites
install_dependencies
fetch_artifacts
start_speculos
start_dstack_simulator
start_memory_stack
print_next_steps
