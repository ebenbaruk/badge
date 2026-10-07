# syntax=docker/dockerfile:1
# Gateway image of the CVM (LLM egress + enclave ingress). The CVM receives only its compose file, never files from
# the operator's machine, so the nginx configuration is baked in here and pinned by the image digest. The local
# stack (infra/compose.yml) mounts the same templates on the stock image instead.
#   docker buildx build --platform linux/amd64 -t badge-gateway infra/gateway
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

# The stock default server (port 80, welcome page) is not part of Badge.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY upstream-tls.conf /etc/nginx/badge-upstream-tls.conf
COPY llm-egress.conf.template enclave-ingress.conf.template /etc/nginx/templates/
COPY 15-badge-upstream.envsh /docker-entrypoint.d/
RUN chmod 0755 /docker-entrypoint.d/15-badge-upstream.envsh
# Only our variables are substituted: nginx's own $variables stay untouched.
ENV NGINX_ENVSUBST_FILTER=^BADGE_
