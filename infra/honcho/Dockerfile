# syntax=docker/dockerfile:1
# Offline Honcho image: the upstream v3.2.2 image (built from infra/vendor/honcho) plus what it would otherwise
# download or get wrong at runtime. Built by infra/stack.sh with:
#   --build-context upstream=docker-image://badge/honcho-upstream:3.2.2
#   --build-context tiktoken=infra/vendor/tiktoken
FROM upstream

# tiktoken fetches cl100k_base / o200k_base from openaipublic.blob.core.windows.net on first use. Honcho runs on a
# network with no route out, so the encodings are baked in (file name = sha1 of the download URL).
COPY --from=tiktoken --chown=app:app . /app/tiktoken_cache/
ENV TIKTOKEN_CACHE_DIR=/app/tiktoken_cache

# Honcho 3.2.2 only sends `max_completion_tokens` to gpt-5 / o-series models and `max_tokens` to everything else.
# OpenAI's gpt-6 family rejects `max_tokens` with a 400, which the deriver turns into silently empty memory.
# The build fails if the upstream line moved, so a Honcho upgrade cannot silently drop the patch.
USER root
RUN sed -i 's/m.startswith("gpt-5.")/m.startswith("gpt-5.") or m.startswith("gpt-6")/' \
      /app/src/llm/backends/openai.py \
    && grep -q 'm.startswith("gpt-6")' /app/src/llm/backends/openai.py

COPY --chown=app:app entrypoint.sh /app/docker/badge-entrypoint.sh
# CVM only (infra/cvm/compose.yml): secrets generated inside the CVM at first boot instead of passed by the operator.
COPY --chown=app:app secrets-env.sh /app/docker/badge-secrets-env.sh
COPY --chown=app:app secrets-init.sh /app/docker/badge-secrets-init.sh
COPY --chown=app:app deriver-entrypoint.sh /app/docker/badge-deriver-entrypoint.sh
USER app
