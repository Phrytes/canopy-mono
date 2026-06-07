# Privatemode models (API reference)

The models the Privatemode API serves, from `GET /v1/models` on the proxy
(`curl -s http://localhost:8080/v1/models`). Captured 2026-06 — re-check against your
deployment, the catalog changes. The `model` field in our config / `FP_MODEL` uses these
exact ids. See `docs.privatemode.ai/models` for capabilities/pricing.

## Chat / generation (what the pipeline uses)

| id | tasks | prompt profile (src/prompt-profiles.js) |
|----|-------|------------------------------------------|
| `gpt-oss-120b` | generate, tool_calling | `minimal` |
| `openai/gpt-oss-120b` | generate, tool_calling | `minimal` (namespaced alias) |
| `kimi-k2.6` | generate, tool_calling, vision | `minimal` |
| `kimi-latest` | generate, tool_calling, vision | `minimal` (alias → latest Kimi) |
| `gemma-4-31b` | generate, tool_calling, vision | `minimal` |

These are reasoning-capable models → they use the **minimal** prompt profile (short
prompts, single clean pass). Local models (`qwen2.5:7b`, `mistral:7b`) stay on `verbose`.

## Embeddings

| id | tasks |
|----|-------|
| `qwen3-embedding-4b` | embed |

(Exposed via the OpenAI-compatible `/v1/embeddings` endpoint — not used by the pipeline yet.)

## Speech-to-text

| id | tasks |
|----|-------|
| `whisper-large-v3` | transcribe |
| `openai/whisper-large-v3` | transcribe |
| `voxtral-mini-3b` | transcribe |

## Notes

- A model not listed in `MODEL_PROFILE` falls back to `verbose` (the safe, tested default),
  so add new chat ids there when assigning them to `minimal`.
- Reasoning models emit many *completion* tokens (the thinking), which dominates usage — see
  the API-usage line the scorer prints.
- **Disabling reasoning** (Privatemode has no unified `reasoning_effort` — it's per-model via
  `chat_template_kwargs`):
  - Kimi K2.6 → `{"thinking": false}`
  - Gemma 4 31B → `{"enable_thinking": false}`
  - gpt-oss-120b → no documented control.
  Wired in `src/ollama.js`: set `FP_LLM_THINKING=off` (global), or `opts.thinking:'off'`, or
  pass `opts.chatTemplateKwargs` explicitly. `chat()` sends the right per-model kwarg. Cuts
  completion tokens + latency "at the cost of quality".
- **Per-task control** (`thinkingFor()` in `src/prompt-profiles.js`): each LLM step reads its
  own toggle, so you can disable reasoning where the task is clear and keep it where it helps.
  Tasks + env vars: `FP_THINKING_LABEL` (signal/crisis/domain detection), `FP_THINKING_CLEAN`,
  `FP_THINKING_SUMMARIZE`, `FP_THINKING_TRANSLATE` — each `off|on`. Precedence:
  `FP_THINKING_<TASK>` > `FP_LLM_THINKING` (global) > model default (on).
  Recommended starting point: `FP_THINKING_LABEL=off` (detection is clear-cut, saves the most
  tokens) and leave `SUMMARIZE` on (benefits from reasoning). Measure both ways.
