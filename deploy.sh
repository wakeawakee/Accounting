#!/usr/bin/env bash
# Deploy the homelab STAGING copy of KarSathi (production = Vercel, deployed from main).
#   ./deploy.sh              build + run the checked-out commit
#   ./deploy.sh rollback abc1234   run an older image again (see: docker images karsathi-web)
set -euo pipefail                      # stop on the first error, so a failed build never goes live
cd "$(dirname "$0")"
COMPOSE="docker compose -f apps/web/compose.yaml"

if [ "${1:-}" = rollback ]; then
  GIT_SHA="${2:?usage: ./deploy.sh rollback <tag>}" $COMPOSE up -d --no-build
else
  git pull --ff-only                   # get new commits; refuses surprise merge commits
  export GIT_SHA=$(git rev-parse --short HEAD)
  $COMPOSE build                       # typecheck + build inside Docker; the old container keeps serving
  $COMPOSE up -d                       # swap to the new image (a few seconds of downtime)
fi

curl -sf --retry 10 --retry-connrefused --retry-delay 1 -o /dev/null http://localhost:4000/healthz   # fail if it doesn't come back
docker images karsathi-web --format '{{.Tag}}' | tail -n +4 | xargs -r -I{} docker rmi karsathi-web:{} >/dev/null   # keep 3 for rollback
echo "Staging is running: $(docker inspect karsathi-web --format '{{.Config.Image}}') — $(git log -1 --format='%h %s')"
