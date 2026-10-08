#!/usr/bin/env bash
# One command for the web demo: local stack, enclave, demo preparation, web app.
#
#   scripts/demo-web.sh [start] [--fresh] [--rehearsal] [--dev]   (pnpm demo:web)
#       Starts (or restarts) the enclave on :8787 and the web app on :3000, after preparing the demo: every
#       employee enrolled, fresh 8-hour agent sessions, the Research desk complete, the compliance key registered.
#       The presenter lands directly on the jury walkthrough (http://localhost:3000/demo).
#         --fresh       archive the previous demo state first (enclave database, web runtime): a clean run
#         --rehearsal   adds "Auto review" under the Ledger mirror (practice only, never in front of the jury)
#         --dev         Next dev server (hot reload) instead of the production build
#   scripts/demo-web.sh stop          stops the enclave and the web app started here (the stack keeps running)
#   scripts/demo-web.sh status        what is running, and until when the agent sessions are valid
#   scripts/demo-web.sh logs [enclave|web]
#
# Restarting is also how expired agent sessions (8 hours) are renewed: the preparation signs them again.
# Stopping the whole local stack: scripts/demo-web.sh stop && infra/speculos.sh stop && infra/dstack-sim.sh stop
# && infra/stack.sh down.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$REPO_ROOT/infra/.data"
RUN_DIR="$STATE_DIR/demo-web"
ENCLAVE_DATA_DIR="$STATE_DIR/enclave"
WEB_DATA_DIR="$REPO_ROOT/apps/web/.data"
WEB_BUILD_ID="$REPO_ROOT/apps/web/.next/BUILD_ID"
CAL_TEST_KEY="$REPO_ROOT/infra/keys/cal-test.pem"
ENCLAVE_PORT=8787
WEB_PORT=3000
READY_TIMEOUT_S=120

if [ -t 1 ]; then BOLD=$'\e[1m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'
else BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""; fi
step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
ok() { printf '%s  ok%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s  !!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die() { printf '%s  xx %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

pid_file() { echo "$RUN_DIR/$1.pid"; }
log_file() { echo "$RUN_DIR/$1.log"; }
listener_pid() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true; }

# A service is ours when its recorded process group still holds the port: never kill what this script did not start.
owned_pid() {
  local service="$1" port="$2" pid listener
  [ -f "$(pid_file "$service")" ] || return 1
  pid="$(cat "$(pid_file "$service")")"
  kill -0 "$pid" 2>/dev/null || return 1
  listener="$(listener_pid "$port")"
  [ -n "$listener" ] || { echo "$pid"; return 0; }
  [ "$(ps -o pgid= -p "$listener" | tr -d ' ')" = "$pid" ] && echo "$pid"
}

stop_service() {
  local service="$1" port="$2" pid
  if pid="$(owned_pid "$service" "$port")"; then
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    local waited=0
    while [ -n "$(listener_pid "$port")" ] && [ "$waited" -lt 15 ]; do sleep 1; waited=$((waited + 1)); done
    ok "$service stopped"
  fi
  rm -f "$(pid_file "$service")"
  local other
  other="$(listener_pid "$port")"
  [ -z "$other" ] || die "port $port is used by another process (PID $other: $(ps -o comm= -p "$other")). Stop it, then retry."
}

# Runs a command in its own process group (so stop kills the whole pnpm/node tree), logging to RUN_DIR.
start_service() {
  local service="$1"
  shift
  : >"$(log_file "$service")"
  (cd "$REPO_ROOT" && exec perl -e 'setpgrp(0, 0); exec @ARGV' "$@") >>"$(log_file "$service")" 2>&1 &
  echo $! >"$(pid_file "$service")"
}

wait_for_port() {
  local service="$1" port="$2" waited=0
  until [ -n "$(listener_pid "$port")" ]; do
    kill -0 "$(cat "$(pid_file "$service")")" 2>/dev/null || {
      tail -n 30 "$(log_file "$service")" >&2
      die "$service exited during startup (log: $(log_file "$service"))"
    }
    [ "$waited" -lt "$READY_TIMEOUT_S" ] || die "$service not listening on :$port after ${READY_TIMEOUT_S}s (log: $(log_file "$service"))"
    sleep 1
    waited=$((waited + 1))
  done
}

# The production build is redone when web or package sources changed since the last one.
web_build_stale() {
  [ -f "$WEB_BUILD_ID" ] || return 0
  [ -n "$(find "$REPO_ROOT/apps/web/src" "$REPO_ROOT/apps/web/public" "$REPO_ROOT/packages" "$REPO_ROOT/infra/seed" \
    -newer "$WEB_BUILD_ID" -type f -not -path '*/node_modules/*' -print -quit 2>/dev/null)" ]
}

archive_state() {
  local archive
  archive="$STATE_DIR/archive/demo-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$archive"
  [ -d "$ENCLAVE_DATA_DIR" ] && mv "$ENCLAVE_DATA_DIR" "$archive/enclave"
  [ -d "$WEB_DATA_DIR" ] && mv "$WEB_DATA_DIR" "$archive/web"
  ok "previous demo state archived in ${archive#"$REPO_ROOT"/}"
}

cmd_stop() {
  mkdir -p "$RUN_DIR"
  step "Stopping the web app and the enclave"
  stop_service web "$WEB_PORT"
  stop_service enclave "$ENCLAVE_PORT"
}

cmd_status() {
  local service port pid
  for service in enclave web; do
    port=$([ "$service" = enclave ] && echo "$ENCLAVE_PORT" || echo "$WEB_PORT")
    if pid="$(owned_pid "$service" "$port")" && [ -n "$(listener_pid "$port")" ]; then ok "$service on :$port (PID $pid)"
    elif [ -n "$(listener_pid "$port")" ]; then warn "$service: :$port is held by a process not started by this script"
    else warn "$service not running"; fi
  done
  if [ -f "$WEB_DATA_DIR/agent-runtime.json" ]; then
    node -e '
      const rt = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).employees;
      for (const [who, s] of Object.entries(rt)) {
        if (!s.agent) continue;
        const left = s.agent.session.expiresAt * 1000 - Date.now();
        console.log(`  ${who}: agent session ${left > 0 ? "valid until " + new Date(s.agent.session.expiresAt * 1000).toLocaleString("en-US") : "EXPIRED (restart to renew)"}`);
      }' "$WEB_DATA_DIR/agent-runtime.json"
  fi
}

cmd_start() {
  local fresh=false rehearsal=false dev=false arg
  for arg in "$@"; do
    case "$arg" in
      --fresh) fresh=true ;;
      --rehearsal) rehearsal=true ;;
      --dev) dev=true ;;
      *) die "unknown option '$arg' (--fresh | --rehearsal | --dev)" ;;
    esac
  done
  mkdir -p "$RUN_DIR"

  step "Local stack (scripts/bootstrap.sh, idempotent)"
  if [ -s "$STATE_DIR/indexed-profile" ]; then
    "$REPO_ROOT/scripts/bootstrap.sh" --skip-seed >"$(log_file bootstrap)" 2>&1 ||
      { tail -n 30 "$(log_file bootstrap)" >&2; die "bootstrap failed (log: $(log_file bootstrap))"; }
    ok "Speculos Ledgers, simulated TEE and memory up (memory already seeded; log: $(log_file bootstrap))"
  else
    "$REPO_ROOT/scripts/bootstrap.sh"
  fi

  cmd_stop
  [ "$fresh" = false ] || archive_state

  step "Enclave (:$ENCLAVE_PORT, simulated TEE)"
  start_service enclave pnpm --filter @badge/enclave start
  wait_for_port enclave "$ENCLAVE_PORT"
  ok "enclave up (log: $(log_file enclave))"

  step "Demo preparation: enrollments, agent sessions, Research desk, compliance key (Ledgers signing automatically)"
  (cd "$REPO_ROOT" && BADGE_CAL_TEST_KEY="$CAL_TEST_KEY" pnpm --silent demo:prepare) | sed 's/^/  /'

  local web_cmd=(pnpm --filter @badge/web start)
  if [ "$dev" = true ]; then
    web_cmd=(pnpm --filter @badge/web dev)
  elif web_build_stale; then
    step "Web app production build"
    (cd "$REPO_ROOT" && pnpm --filter @badge/web build >"$(log_file build)" 2>&1) ||
      { tail -n 30 "$(log_file build)" >&2; die "web build failed (log: $(log_file build))"; }
    ok "built"
  fi
  step "Web app (:$WEB_PORT, $([ "$dev" = true ] && echo "dev server" || echo "production build"), $([ "$rehearsal" = true ] && echo "rehearsal mode" || echo "presenter mode"))"
  if [ "$rehearsal" = true ]; then
    start_service web env BADGE_REHEARSAL=1 BADGE_CAL_TEST_KEY="$CAL_TEST_KEY" "${web_cmd[@]}"
  else
    start_service web env BADGE_CAL_TEST_KEY="$CAL_TEST_KEY" "${web_cmd[@]}"
  fi
  wait_for_port web "$WEB_PORT"
  ok "web app up (log: $(log_file web))"

  step "Ready"
  cat <<EOF
  Landing page    http://localhost:$WEB_PORT
  Demo            http://localhost:$WEB_PORT/demo   (window at least 1280 px wide: the Ledger mirror is on the right)
  Walkthrough     INSTALL.md, section "Web demo walkthrough"
  Signing         on the Ledger mirror: click = tap, swipe left = next page, press and hold ~3 s on "Hold to sign"
$([ "$rehearsal" = true ] && echo '                  rehearsal mode: "Auto review" under the mirror approves a whole review at once')

  Agent sessions last 8 hours: run this command again to renew them (and --fresh for a clean demo).
  Stop: pnpm demo:web stop
EOF
}

case "${1:-start}" in
  start) shift || true; cmd_start "$@" ;;
  --*) cmd_start "$@" ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  logs) tail -n 100 -f "$(log_file "${2:-web}")" ;;
  -h | --help | help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$1' (start | stop | status | logs | --help)" ;;
esac
