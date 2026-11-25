#!/usr/bin/env bash
# Nightly Supabase database backup: pg_dump (in a throwaway Docker container) → gzip → /mnt/storage, keep 14.
# Setup once: put the Session pooler URI (Supabase → Connect → Session pooler) in ~/.config/karsathi/backup.env:
#   DATABASE_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
#   OFFSITE=remote:karsathi-backups   # optional: an rclone remote (Backblaze B2, R2, Google Drive...) for the off-site copy
# Cron (03:15 daily):  15 3 * * * /mnt/storage/home/homelab/projects/karsathi/Accounting/ops/backup-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
CONF="$HOME/.config/karsathi/backup.env"
DIR=/mnt/storage/backups/karsathi
fail() { ops/notify.sh "🔴 KarSathi backup FAILED" "$1" 5; echo "$1" >&2; exit 1; }
trap 'fail "backup-db.sh stopped at line $LINENO"' ERR

[ -r "$CONF" ] || fail "$CONF missing"
. "$CONF"
mkdir -p "$DIR"; chmod 700 "$DIR"
OUT="$DIR/karsathi-$(date +%Y%m%d-%H%M).sql.gz"

# Our data (public), logins (auth) and file metadata (storage). The uploaded files themselves live in Supabase Storage.
docker run --rm -e DATABASE_URL postgres:17-alpine \
  pg_dump "$DATABASE_URL" --no-owner --no-privileges -n public -n auth -n storage \
  | gzip > "$OUT.tmp"
gzip -t "$OUT.tmp" && [ "$(zcat "$OUT.tmp" | grep -c 'CREATE TABLE')" -gt 10 ] || fail "dump looks empty or corrupt"
mv "$OUT.tmp" "$OUT"; chmod 600 "$OUT"

ls -1t "$DIR"/karsathi-*.sql.gz | tail -n +15 | xargs -r rm --          # keep the newest 14
if [ -n "${OFFSITE:-}" ]; then rclone copy "$OUT" "$OFFSITE" || fail "off-site copy to $OFFSITE failed"; fi
echo "Backup OK: $OUT ($(du -h "$OUT" | cut -f1))"
