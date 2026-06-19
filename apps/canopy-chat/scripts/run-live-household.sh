#!/usr/bin/env bash
#
# Live HOUSEHOLD pipeline — single-process, against the Privatemode loopback proxy
# (LLM gpt-oss-120b + embeddings qwen3-embedding-4b, both via /v1 on :8080).
#
# Robust runner (no fragile multi-line env one-liners). Run from anywhere:
#
#   LLM_APIKEY=<privatemode-project-key> bash apps/canopy-chat/scripts/run-live-household.sh
#
# - LLM_APIKEY is optional if your loopback proxy needs no auth.
# - Override any default by exporting it first, e.g. OLLAMA_MODEL=kimi-k2.6.
# - Point at local Ollama instead:  OLLAMA_BASEURL=http://127.0.0.1:11434
#     OLLAMA_MODEL=qwen2.5:7b-instruct  EMBED_BASEURL=  (empty → lexical, no embeddings)
#
set -euo pipefail
cd "$(dirname "$0")/.."                      # → apps/canopy-chat

export LIVE_LLM=1
export OLLAMA_BASEURL="${OLLAMA_BASEURL:-http://localhost:8080}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-gpt-oss-120b}"
export EMBED_BASEURL="${EMBED_BASEURL-http://localhost:8080}"   # set EMBED_BASEURL= to disable semantic
export EMBED_MODEL="${EMBED_MODEL:-qwen3-embedding-4b}"
# LLM_APIKEY / EMBED_APIKEY pass straight through from your shell (unset = no Bearer).

echo "[live] LLM:   $OLLAMA_MODEL @ $OLLAMA_BASEURL  (key: ${LLM_APIKEY:+set}${LLM_APIKEY:-none})"
echo "[live] EMBED: ${EMBED_MODEL:-<provider default>} @ ${EMBED_BASEURL:-<disabled → lexical>}"
echo

exec npx vitest run test/live/householdPipeline.live.test.js
