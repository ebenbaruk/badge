#!/bin/sh
# One-shot service of the CVM (infra/cvm/compose.yml), run as root before Postgres and Honcho start:
#  - generates the Honcho JWT secret and the database password once (kept on the CVM's encrypted disk, reused on
#    every later boot, gone when the CVM is deleted);
#  - mints the Honcho admin JWT the enclave uses (the enclave reads every scope; agents never see it).
# Nothing is printed: the values never leave the CVM.
set -eu
dir="${BADGE_SECRETS_DIR:?BADGE_SECRETS_DIR is required}"
umask 077
mkdir -p "$dir"

generate() {
  [ -s "$dir/$1" ] || /app/.venv/bin/python -c 'import secrets, sys; sys.stdout.write(secrets.token_hex(32))' >"$dir/$1"
}
generate honcho-jwt-secret
generate db-password

if [ ! -s "$dir/honcho-admin.jwt" ]; then
  token="$(AUTH_USE_AUTH=true AUTH_JWT_SECRET="$(cat "$dir/honcho-jwt-secret")" \
    /app/.venv/bin/python scripts/generate_jwt.py --admin --print-only)"
  case "$token" in
    ey*.*.*) printf '%s' "$token" >"$dir/honcho-admin.jwt" ;;
    *) echo "[badge] could not mint the Honcho admin JWT" >&2; exit 1 ;;
  esac
fi

# Readable by the other containers of the CVM (postgres, Honcho's app user, the enclave's node user run under
# different uids). The confidentiality boundary is the CVM: the volume is only mounted, read-only, where needed.
chmod 0755 "$dir"
chmod 0444 "$dir/honcho-jwt-secret" "$dir/db-password" "$dir/honcho-admin.jwt"
echo "[badge] secrets ready"
