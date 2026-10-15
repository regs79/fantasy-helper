#!/usr/bin/env bash
# Build the amd64 release image, tag it with the git short SHA, push it to the
# registry named in .env, and — if DEPLOY_SSH is set — roll the host forward to
# it. One immutable tag per build; rollback is `TAG=<old sha> docker compose up -d`
# on the host.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a
: "${REGISTRY:?set REGISTRY in .env (host:port)}"
: "${IMAGE:=fantasy-helper}"

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to release with uncommitted changes" >&2
  exit 1
fi

TAG="$(git rev-parse --short HEAD)"
REF="${REGISTRY}/${IMAGE}:${TAG}"

# The default buildx driver reads the daemon's insecure-registries; a
# docker-container builder would need its own buildkitd config.
docker buildx build --platform linux/amd64 --build-arg "BUILD_TAG=$TAG" --tag "$REF" --push .
echo
echo "pushed $REF"

if [ -z "${DEPLOY_SSH:-}" ]; then
  echo "deploy: TAG=$TAG docker compose up -d   (set DEPLOY_SSH and DEPLOY_DIR in .env to do this automatically)"
  exit 0
fi

: "${DEPLOY_DIR:?set DEPLOY_DIR in .env (compose directory on the host)}"
echo "deploying to $DEPLOY_SSH:$DEPLOY_DIR"
# compose.yml is copied alongside the remote .env, which holds TAG and the
# Yahoo credentials (REGISTRY is left unset there so the image resolves to
# localhost:5000, the registry on the host itself). Success is claimed only if the running image really
# carries the new tag.
# The data dir is a bind mount owned by the login user, which the image's
# `node` user (uid 1000) can write.
ssh "$DEPLOY_SSH" "mkdir -p '$DEPLOY_DIR' ~/docker/data/fantasy-helper"
scp -q compose.yml "$DEPLOY_SSH:$DEPLOY_DIR/compose.yml"
# shellcheck disable=SC2029
ssh "$DEPLOY_SSH" "set -e; cd '$DEPLOY_DIR'
  touch .env
  if grep -q '^TAG=' .env; then sed -i 's/^TAG=.*/TAG=$TAG/' .env; else echo 'TAG=$TAG' >> .env; fi
  docker compose pull -q
  docker compose up -d
  docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
  docker compose ps --format '{{.Image}}' | grep -q ':$TAG\$' || {
    echo 'running image does not carry the new tag; does compose.yml use \${TAG}?' >&2; exit 1; }"
echo "deployed $TAG"
