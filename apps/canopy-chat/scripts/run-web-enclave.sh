#!/usr/bin/env bash
#
# Live WEB circle bot — gpt-oss-120b (LLM) + qwen3-embedding-4b (F-retrieve tier-2),
# both served by the Privatemode loopback proxy on :8080 and routed through Vite's
# `/llm` SAME-ORIGIN proxy so the browser bot avoids cross-origin CORS (and no key
# ever reaches the page). This is the in-app sibling of `run-live-household.sh`.
#
#   bash apps/canopy-chat/scripts/run-web-enclave.sh        # → http://localhost:5173
#
# Then: open a circle → switch to GESPREK (chat) → address the assistant
# ("@assistant add milk to the shopping list", "what do I still need to get?").
#
# Override any default by exporting it first. Local Ollama instead of the enclave:
#   VITE_CIRCLE_LLM_BASEURL=http://localhost:11434 VITE_CIRCLE_LLM_MODEL=qwen2.5:7b-instruct \
#   VITE_CIRCLE_LLM_TIMEOUT_MS=180000  bash apps/canopy-chat/scripts/run-web-enclave.sh
#   (CPU-only Ollama is ~60s/turn → the longer timeout keeps the turn from aborting.)
set -euo pipefail
cd "$(dirname "$0")/.."                       # → apps/canopy-chat

# LLM + embeddings both ride the enclave via the /llm proxy (LLM_PROXY_TARGET → :8080).
export VITE_CIRCLE_LLM_BASEURL="${VITE_CIRCLE_LLM_BASEURL:-/llm}"
export VITE_CIRCLE_LLM_MODEL="${VITE_CIRCLE_LLM_MODEL:-gpt-oss-120b}"
export VITE_CIRCLE_EMBED_BASEURL="${VITE_CIRCLE_EMBED_BASEURL:-/llm}"
export VITE_CIRCLE_EMBED_MODEL="${VITE_CIRCLE_EMBED_MODEL:-qwen3-embedding-4b}"
export VITE_CIRCLE_LLM_POLICY="${VITE_CIRCLE_LLM_POLICY:-user}"
export LLM_PROXY_TARGET="${LLM_PROXY_TARGET:-http://localhost:8080}"
# VITE_CIRCLE_LLM_APIKEY passes straight through if your enclave needs a Bearer key.

echo "[web] LLM:   $VITE_CIRCLE_LLM_MODEL  via $VITE_CIRCLE_LLM_BASEURL  (proxy → $LLM_PROXY_TARGET)"
echo "[web] EMBED: $VITE_CIRCLE_EMBED_MODEL  via $VITE_CIRCLE_EMBED_BASEURL"
echo

exec npm run dev -- --host 0.0.0.0
