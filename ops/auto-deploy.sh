#!/usr/bin/env bash
# Pull-based CD for staging: if main moved on GitHub, deploy it. Runs from cron every 5 minutes.
# Pull, not push: GitHub never needs a way into the homelab, so no open ports and no deploy secrets in CI.
set -euo pipefail
cd "$(dirname "$0")/.."
exec 9>"/tmp/karsathi-deploy.lock"; flock -n 9 || exit 0   # never run two deploys at once

git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0

if out=$(./deploy.sh 2>&1); then
  ops/notify.sh "🚀 Staging deployed" "$(git log -1 --format='%h %s')" 3
else
  ops/notify.sh "🔴 Staging deploy FAILED" "$(echo "$out" | tail -5)" 5
  exit 1
fi
