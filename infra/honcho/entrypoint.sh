#!/bin/sh
# Honcho API entrypoint: migrations, then resize the pgvector columns to EMBEDDING_VECTOR_DIMENSIONS, then the API.
# Why: migrations create vector(1536) columns and the API refuses to boot when they disagree with the configured
# dimension. configure_embeddings is a no-op once the columns already have the right size.
set -eu
echo "[badge] database migrations"
/app/.venv/bin/python scripts/provision_db.py
echo "[badge] embedding columns -> ${EMBEDDING_VECTOR_DIMENSIONS} dimensions"
/app/.venv/bin/python scripts/configure_embeddings.py --yes
echo "[badge] starting Honcho API"
exec /app/.venv/bin/fastapi run --host 0.0.0.0 --workers "${API_WORKERS:-1}" src/main.py
