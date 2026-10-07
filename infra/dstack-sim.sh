#!/usr/bin/env bash
# Local dstack simulator (TEE guest agent API, no real TDX) for development and integration tests.
#   ./dstack-sim.sh start    download if needed, then run in the background on http://127.0.0.1:8090
#   ./dstack-sim.sh stop     stop the background simulator
#   ./dstack-sim.sh status   print whether it is running
# Point the SDK at it with DSTACK_SIMULATOR_ENDPOINT=http://127.0.0.1:8090.
#
# 0.5.3 is the last dstack release that ships simulator binaries; its quote, event log and compose hash are
# fixed files, so anything it attests must be treated as SIMULATED (never as a real TEE).
set -euo pipefail
cd "$(dirname "$0")"

VERSION="0.5.3"
HOST="${DSTACK_SIM_HOST:-127.0.0.1}"
PORT="${DSTACK_SIM_PORT:-8090}"
VENDOR_DIR="vendor/dstack-sim"
PIDFILE="$VENDOR_DIR/dstack-sim.pid"
LOGFILE="$VENDOR_DIR/dstack-sim.log"
RELEASE_URL="https://github.com/Dstack-TEE/dstack/releases/download/v$VERSION"

# Release asset digests (from the GitHub release metadata): a tampered download must never run.
target_and_sha() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) echo "aarch64-apple-darwin 42e8a43aff515b3ad08bebdbeb44edd5a94d1e729e0bd035b1104403e998c7c5" ;;
    Linux-x86_64) echo "x86_64-linux-gnu 6c5b07b89dd12ccf31353919f51a353ee3ac63765425f8648bc04b7305e50075" ;;
    *) echo "Unsupported host $(uname -s)-$(uname -m): no dstack $VERSION simulator binary" >&2; exit 1 ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

is_running() {
  [ -s "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

install_sim() {
  read -r target sha <<<"$(target_and_sha)"
  local name="dstack-simulator-$VERSION-$target"
  SIM_DIR="$VENDOR_DIR/$name"
  [ -x "$SIM_DIR/dstack-simulator" ] && return 0
  mkdir -p "$VENDOR_DIR"
  local archive="$VENDOR_DIR/$name.tgz"
  echo "Downloading $name.tgz"
  curl -fsSL -o "$archive" "$RELEASE_URL/$name.tgz"
  local actual
  actual="$(sha256_of "$archive")"
  if [ "$actual" != "$sha" ]; then
    rm -f "$archive"
    echo "Checksum mismatch for $name.tgz (expected $sha, got $actual)" >&2
    exit 1
  fi
  tar xzf "$archive" -C "$VENDOR_DIR"
  rm -f "$archive"
  [ -x "$SIM_DIR/dstack-simulator" ] || { echo "Archive did not contain $SIM_DIR/dstack-simulator" >&2; exit 1; }
}

# The shipped config listens on a unix socket; the (undocumented) `port` key switches it to TCP.
write_config() {
  local src="$SIM_DIR/dstack.toml" dst="$SIM_DIR/dstack-tcp.toml"
  grep -q 'address = "unix:./dstack.sock"' "$src" || { echo "Unexpected $src layout, cannot patch" >&2; exit 1; }
  # awk rather than sed: BSD sed (macOS) does not expand \n in replacements.
  awk -v host="$HOST" -v port="$PORT" \
    '$0 == "address = \"unix:./dstack.sock\"" { print "address = \"" host "\""; print "port = " port; next } { print }' \
    "$src" >"$dst"
  CONFIG="dstack-tcp.toml"
}

start() {
  if is_running; then echo "dstack simulator already running (pid $(cat "$PIDFILE")) on http://$HOST:$PORT"; return 0; fi
  install_sim
  write_config
  # The simulator reads its fixture files (quote.hex, eventlog.json...) relative to its working directory.
  local infra_dir="$PWD"
  cd "$SIM_DIR"
  nohup ./dstack-simulator -c "$CONFIG" >"$infra_dir/$LOGFILE" 2>&1 &
  echo $! >"$infra_dir/$PIDFILE"
  cd "$infra_dir"
  for _ in $(seq 1 50); do
    if curl -fsS -X POST "http://$HOST:$PORT/Info" -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1; then
      echo "dstack simulator $VERSION running (pid $(cat "$PIDFILE")) on http://$HOST:$PORT"
      return 0
    fi
    is_running || break
    sleep 0.2
  done
  echo "dstack simulator failed to start, see infra/$LOGFILE" >&2
  exit 1
}

stop() {
  if is_running; then
    kill "$(cat "$PIDFILE")"
    echo "dstack simulator stopped"
  else
    echo "dstack simulator not running"
  fi
  rm -f "$PIDFILE"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) if is_running; then echo "running (pid $(cat "$PIDFILE")) on http://$HOST:$PORT"; else echo "stopped"; exit 1; fi ;;
  *) echo "Usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac
