#!/usr/bin/env bash
# Launch tasks-ui with the V1.5 Telegram bot wired in.
#
# Usage:
#   1. Edit the variables below (or override at the call site:
#        ACTOR=https://id.example/frits ./scripts/run-bot.sh).
#   2. Put your token in $TG_TOKEN before running, e.g.:
#        export TG_TOKEN='123456:ABC...'
#      Or drop it into ./.tg-token (gitignored — see below) and the
#      script picks it up automatically.
#   3. ./scripts/run-bot.sh
#
# The script `cd`s to the app root so all relative paths work
# regardless of where you invoke it from.

set -euo pipefail

# ── Defaults (override via env) ───────────────────────────────────────────
ACTOR="${ACTOR:-https://id.example/anne}"
CREW="${CREW:-/tmp/oss-tools.crew.json}"
STORAGE_ROOT="${STORAGE_ROOT:-./.tasks-data}"
PORT="${PORT:-8080}"
PUSH="${PUSH:-0}"   # set PUSH=1 to also enable --push (Expo)

# Resolve the app root (one level up from this script).
APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_ROOT"

# Token: env wins, else ./.tg-token if present.
TOKEN_SOURCE='env'
if [ -z "${TG_TOKEN:-}" ] && [ -r "./.tg-token" ]; then
  TG_TOKEN="$(tr -d '[:space:]' < ./.tg-token)"
  TOKEN_SOURCE='./.tg-token'
fi

if [ -z "${TG_TOKEN:-}" ]; then
  echo "ERROR: no Telegram token found." >&2
  echo "  Either: export TG_TOKEN='123456:ABC...'" >&2
  echo "  Or:     echo '123456:ABC...' > ./.tg-token" >&2
  exit 2
fi

# Token diagnostic: confirms it survived the read step intact.
TOKEN_LEN=${#TG_TOKEN}
TOKEN_HEAD="${TG_TOKEN:0:6}"
TOKEN_TAIL="${TG_TOKEN: -4}"
echo "Token source: $TOKEN_SOURCE  (len=$TOKEN_LEN  head=$TOKEN_HEAD…  tail=…$TOKEN_TAIL)"

# Pre-flight the token against Telegram's /getMe before handing it to
# Node — surfaces 404s (revoked, typo'd, mangled by storage) cleanly.
if command -v curl >/dev/null 2>&1; then
  PREFLIGHT="$(curl -sS -o /dev/null -w '%{http_code}' "https://api.telegram.org/bot${TG_TOKEN}/getMe" || true)"
  if [ "$PREFLIGHT" != "200" ]; then
    echo "ERROR: Telegram rejected the token at /getMe (HTTP $PREFLIGHT)." >&2
    echo "  Try the same token by hand:" >&2
    echo "    curl \"https://api.telegram.org/bot\$(cat ./.tg-token)/getMe\"" >&2
    echo "  If that works, the script is mangling the token — paste \`cat -A ./.tg-token\` and we'll dig in." >&2
    exit 3
  fi
  echo 'Pre-flight OK (Telegram /getMe → 200)'
fi

if [ ! -r "$CREW" ]; then
  echo "ERROR: crew config not readable at: $CREW" >&2
  exit 2
fi

ARGS=(
  --actor          "$ACTOR"
  --crew           "$CREW"
  --storage-root   "$STORAGE_ROOT"
  --port           "$PORT"
  --telegram-token "$TG_TOKEN"
)
if [ "$PUSH" = "1" ]; then
  ARGS+=( --push )
fi

echo "Launching tasks-ui:"
echo "  actor:        $ACTOR"
echo "  crew:         $CREW"
echo "  storage-root: $STORAGE_ROOT"
echo "  port:         $PORT"
echo "  push:         $([ "$PUSH" = "1" ] && echo on || echo off)"
echo

exec node bin/tasks-ui.js "${ARGS[@]}"
