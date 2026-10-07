#!/bin/sh
# Honcho deriver entrypoint: the secrets (secrets-env.sh), then the deriver.
set -eu
. /app/docker/badge-secrets-env.sh
exec /app/.venv/bin/python -m src.deriver
