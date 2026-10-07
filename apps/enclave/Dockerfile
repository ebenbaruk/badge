# syntax=docker/dockerfile:1
# Badge enclave image (runs in the Phala dstack CVM). Build from the repository root, always for linux/amd64:
#   docker buildx build --platform linux/amd64 -f apps/enclave/Dockerfile -t badge-enclave .
# infra/cvm/build-push.sh builds, pushes and pins it by digest in infra/cvm/compose.yml.
#
# No secret is baked in: LLM settings, Honcho credentials and the data directory come from the CVM at runtime.
# The workspace packages ship TypeScript sources (no build step); tsx runs them, exactly as in development.
# Semaphore proving artifacts are not included: the enclave only verifies desk proofs (verification keys are part
# of @semaphore-protocol), proofs are created by the employees' clients.

ARG NODE_IMAGE=node:24.10.0-bookworm-slim@sha256:b8d2197aff9129d16c801a3e3e1b2a873c4946480f5a310f38056df2268c38d9
ARG PNPM_VERSION=11.17.0

FROM ${NODE_IMAGE} AS deps
ARG PNPM_VERSION
RUN npm install --global --no-fund --no-audit "pnpm@${PNPM_VERSION}"
WORKDIR /app
# Every workspace manifest is needed for a frozen install, even of the packages the enclave does not use.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents apps/*/package.json packages/*/package.json ./
# Production dependencies of @badge/enclave and of the workspace packages it depends on, nothing else.
RUN pnpm install --frozen-lockfile --prod --filter "@badge/enclave..."

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    BADGE_ENCLAVE_HOST=0.0.0.0 \
    BADGE_ENCLAVE_PORT=8787 \
    BADGE_DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY apps/enclave/package.json apps/enclave/tsconfig.json apps/enclave/
COPY apps/enclave/src apps/enclave/src
COPY packages/attest/src packages/attest/src
COPY packages/client/src packages/client/src
COPY packages/consent/src packages/consent/src
COPY packages/zk/src packages/zk/src
# The directory dataset (loaded at boot) and the seed script run by the CVM's one-shot seed service.
COPY infra/seed infra/seed
# Unit tests are not part of the image.
RUN find apps packages -name '*.test.ts' -delete \
    && mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/enclave
EXPOSE 8787
VOLUME ["/data"]
# tsx from the enclave's own dependencies (pnpm --filter start would pull pnpm into the runtime image).
CMD ["node", "--import", "tsx", "src/main.ts"]
