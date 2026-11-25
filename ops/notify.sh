#!/usr/bin/env bash
# Push a message to your phone via ntfy (app: ntfy, subscribe to the topic in ~/.config/karsathi/alerts.env).
# Usage: ops/notify.sh "title" "message" [priority 1-5]
set -euo pipefail
CONF="$HOME/.config/karsathi/alerts.env"
[ -r "$CONF" ] || { echo "notify: $CONF missing, skipping: $1 — $2" >&2; exit 0; }
. "$CONF"   # NTFY_TOPIC=..., optional NTFY_SERVER=https://ntfy.sh
curl -fsS -m 10 -H "Title: $1" -H "Priority: ${3:-4}" -H "Tags: karsathi" -d "$2" \
  "${NTFY_SERVER:-https://ntfy.sh}/${NTFY_TOPIC:?set NTFY_TOPIC in $CONF}" >/dev/null
