#!/usr/bin/env bash
# Checks production, staging and Supabase; alerts your phone only when something goes DOWN or comes back UP.
# Cron (every 5 min):  */5 * * * * /mnt/storage/home/homelab/projects/karsathi/Accounting/ops/uptime-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
STATE="$HOME/.local/state/karsathi-uptime"; mkdir -p "$STATE"
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' apps/web/.env | cut -d= -f2-)

check() {   # name url [extra curl args]
  local name=$1 url=$2; shift 2
  local code; code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$@" "$url")
  local was; was=$(cat "$STATE/$name" 2>/dev/null || echo up)
  if [ "$code" = 200 ]; then
    [ "$was" = down ] && ops/notify.sh "✅ $name is back" "$url → HTTP 200" 3
    echo up > "$STATE/$name"
  else
    [ "$was" = up ] && ops/notify.sh "🔴 $name is DOWN" "$url → HTTP $code at $(date '+%F %T')" 5
    echo down > "$STATE/$name"
  fi
}

check production https://karsathi-seven.vercel.app/
check staging    http://localhost:4000/healthz
check supabase   https://ctwzlczmbpsvbroyqcaw.supabase.co/auth/v1/health -H "apikey: $KEY"
