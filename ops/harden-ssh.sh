#!/usr/bin/env bash
# SSH: keys only, no root login. Refuses to run until a key login is set up, so you can't lock yourself out.
# Before:  on your Mac run  ssh-copy-id <user>@100.78.163.62   and check  ssh <user>@100.78.163.62  works without a password.
# Run:     sudo bash ops/harden-ssh.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
U="${SUDO_USER:?run via sudo from your normal user}"
H=$(getent passwd "$U" | cut -d: -f6)

[ -s "$H/.ssh/authorized_keys" ] || { echo "STOP: $H/.ssh/authorized_keys is empty. Run ssh-copy-id from your Mac first."; exit 1; }
echo "Keys allowed to log in as $U:"; awk '{print "  " $1, $NF}' "$H/.ssh/authorized_keys"

cat > /etc/ssh/sshd_config.d/10-hardening.conf <<'EOF'
# Managed by ops/harden-ssh.sh
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
EOF

sshd -t                      # validate config; on error nothing is reloaded
systemctl reload ssh         # existing sessions stay open
echo "Done. Keep this session open, and confirm a NEW 'ssh $U@100.78.163.62' still works from your Mac."
echo "Undo if needed:  sudo rm /etc/ssh/sshd_config.d/10-hardening.conf && sudo systemctl reload ssh"
