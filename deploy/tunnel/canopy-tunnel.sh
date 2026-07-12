#!/usr/bin/env bash
# canopy-tunnel.sh — run the cloudflared tunnel to the local relay and record the
# current public URL to ~/.canopy-relay-url. Under the systemd user service
# (Restart=always + linger) this survives crashes / logout / reboot.
#
# NOTE: a cloudflared QUICK tunnel gets a fresh random URL on each (re)start, so
# read ~/.canopy-relay-url for the current one. A truly STABLE URL needs either an
# ngrok free static domain (no card, no domain) or a Cloudflare NAMED tunnel with a
# domain you control.
set -uo pipefail
URLFILE="$HOME/.canopy-relay-url"
CF="$HOME/.local/bin/cloudflared"
"$CF" tunnel --url http://localhost:8787 --no-autoupdate 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  if [[ "$line" == *trycloudflare.com* ]]; then
    u=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' <<<"$line" | head -1)
    [[ -n "${u:-}" ]] && printf '%s\n' "$u" > "$URLFILE"
  fi
done
