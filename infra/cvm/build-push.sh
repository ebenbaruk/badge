#!/usr/bin/env bash
# Images of the Phala CVM (always linux/amd64: Phala's TDX hosts are x86_64, an arm64 image does not start).
#   infra/cvm/build-push.sh build   build the three images locally (tags badge-*:cvm-amd64), nothing leaves the machine
#   infra/cvm/build-push.sh push    build, push to the registry, then pin the pushed digests in infra/cvm/compose.yml
#
# Registry: public images on ghcr.io/ebenbaruk (BADGE_REGISTRY to override). Public is deliberate: the CVM pulls
# them without registry credentials (no extra secret to hand to the CVM), and they contain no secret at all (keys
# and Honcho credentials only exist inside the running CVM). Anyone can pull them, which is what lets a third
# party rebuild and compare the digests the compose hash pins. `push` needs `docker login ghcr.io` beforehand
# (a GitHub token with write:packages) and the packages set to public once in GitHub.
#
# After `push`, commit the updated compose.yml: the digests are part of the attested code.
set -euo pipefail

CVM_DIR="$(cd "$(dirname "$0")" && pwd)"
INFRA_DIR="$(cd "$CVM_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INFRA_DIR/.." && pwd)"
COMPOSE_FILE="$CVM_DIR/compose.yml"
REGISTRY="${BADGE_REGISTRY:-ghcr.io/ebenbaruk}"
PLATFORM="linux/amd64"
LOCAL_TAG="cvm-amd64"
# Built by infra/stack.sh with BADGE_PLATFORM=linux/amd64 (same Honcho image as the local stack).
HONCHO_LOCAL_IMAGE="badge/honcho:3.2.2-amd64"
IMAGES=(badge-enclave badge-gateway badge-honcho)

die() { echo "build-push.sh: $*" >&2; exit 1; }

local_ref() {
  if [ "$1" = "badge-honcho" ]; then printf '%s' "$HONCHO_LOCAL_IMAGE"; else printf '%s:%s' "$1" "$LOCAL_TAG"; fi
}

build_all() {
  docker info >/dev/null 2>&1 || die "Docker is not running"
  echo "building badge-enclave ($PLATFORM)"
  docker buildx build --platform "$PLATFORM" --load -q -t "$(local_ref badge-enclave)" \
    -f "$REPO_ROOT/apps/enclave/Dockerfile" "$REPO_ROOT" >/dev/null
  echo "building badge-gateway ($PLATFORM)"
  docker buildx build --platform "$PLATFORM" --load -q -t "$(local_ref badge-gateway)" "$INFRA_DIR/gateway" >/dev/null
  echo "building badge-honcho ($PLATFORM)"
  BADGE_PLATFORM="$PLATFORM" "$INFRA_DIR/stack.sh" build
  local image arch
  for image in "${IMAGES[@]}"; do
    arch="$(docker image inspect --format '{{.Architecture}}' "$(local_ref "$image")")"
    [ "$arch" = "amd64" ] || die "$(local_ref "$image") is $arch, not amd64"
  done
}

# Digest of a pushed reference, as the registry serves it (the value the CVM will verify when pulling).
registry_digest() {
  docker buildx imagetools inspect "$1" | awk '$1 == "Digest:" { print $2; exit }'
}

pin_digest() {
  local image="$1" digest="$2"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "unexpected digest for $image: '$digest'"
  grep -q "image: $REGISTRY/$image@sha256:" "$COMPOSE_FILE" || die "$image is not referenced in $COMPOSE_FILE"
  # Portable in-place edit (BSD and GNU sed differ on -i).
  sed -E "s#(image: $REGISTRY/$image)@sha256:[0-9a-f]{64}#\\1@$digest#" "$COMPOSE_FILE" >"$COMPOSE_FILE.tmp"
  mv "$COMPOSE_FILE.tmp" "$COMPOSE_FILE"
}

push_all() {
  local version
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ] && [ "${BADGE_ALLOW_DIRTY:-}" != "1" ]; then
    die "uncommitted changes: images must be built from a commit (BADGE_ALLOW_DIRTY=1 to override)"
  fi
  version="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
  build_all
  local image remote digest
  for image in "${IMAGES[@]}"; do
    remote="$REGISTRY/$image:$version"
    docker tag "$(local_ref "$image")" "$remote"
    echo "pushing $remote"
    docker push -q "$remote" >/dev/null
    digest="$(registry_digest "$remote")"
    pin_digest "$image" "$digest"
    echo "  pinned $REGISTRY/$image@$digest"
  done
  echo "compose.yml updated: review and commit it, then run infra/phala-up.sh"
}

case "${1:-}" in
  build) build_all ;;
  push) push_all ;;
  *) die "usage: $0 build | push" ;;
esac
