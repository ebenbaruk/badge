#!/bin/sh
# Sourced by the Honcho entrypoints. In the CVM the Honcho secrets are not passed as environment variables: they are
# generated at first boot inside the CVM by secrets-init.sh (BADGE_SECRETS_DIR, on the CVM's encrypted disk), so no
# operator ever knows them. The local stack passes them as variables and leaves BADGE_SECRETS_DIR unset.
if [ -n "${BADGE_SECRETS_DIR:-}" ]; then
  for name in honcho-jwt-secret db-password; do
    [ -s "$BADGE_SECRETS_DIR/$name" ] || { echo "[badge] missing secret $BADGE_SECRETS_DIR/$name" >&2; exit 1; }
  done
  AUTH_JWT_SECRET="$(cat "$BADGE_SECRETS_DIR/honcho-jwt-secret")"
  DB_CONNECTION_URI="postgresql+psycopg://postgres:$(cat "$BADGE_SECRETS_DIR/db-password")@database:5432/postgres"
  export AUTH_JWT_SECRET DB_CONNECTION_URI
fi
