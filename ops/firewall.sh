#!/usr/bin/env bash
# Homelab firewall: deny all inbound, allow only what has a reason. Everything admin goes over Tailscale.
# Run:  sudo bash ops/firewall.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }

echo "== Rules that already exist (kept):"; ufw show added || true

ufw default deny incoming     # nothing gets in unless a rule below says so
ufw default allow outgoing    # server can still reach Supabase, GitHub, apt, Cloudflare...

ufw allow in on tailscale0 to any port 22 proto tcp   comment 'SSH via Tailscale only'
ufw allow in on tailscale0 to any port 4000 proto tcp comment 'KarSathi staging via Tailscale only'
ufw allow 41641/udp                                   comment 'Tailscale direct connections'
ufw logging low

ufw --force enable
ufw status verbose

# Lockout guard: keep the firewall only if a NEW ssh session over Tailscale works.
echo
echo ">>> From your Mac, open a NEW terminal and run:  ssh $(logname 2>/dev/null || echo you)@100.78.163.62"
if read -r -t 120 -p ">>> Did the new SSH login work? Press Enter within 120s to KEEP the firewall: "; then
  echo "Firewall kept. ✓"
else
  echo; echo "No confirmation — disabling the firewall to be safe."; ufw disable
fi
