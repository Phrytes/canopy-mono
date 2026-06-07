# Parameters & knobs — onboarding checklist

Every parameter that shapes a deployment, in one place, to walk through when onboarding a new
project (filling in the ProjectConfig "form"). Columns: **default** (— = must decide, no
default) and **where** it's set (config = the ProjectConfig form / env = environment / code =
a source constant).

> The ProjectConfig **form is the single source** — including the LLM runtime knobs
> (`llm.promptProfile` / `llm.reasoning` / `llm.rateLimit`). The matching env vars (§C) still
> work as **test overrides** when there's no form. `CONFIG_TIERS` (in
> `src/config/project-config.js`) is the machine-readable common/advanced split a form UI renders.

## A1. The form — COMMON (decide per project)

| field | default | meaning / onboarding note |
|---|---|---|
| `projectId` | — | unique id. **Decide.** |
| `projectName` | (optional) | human label. |
| `llm.route` | — | `privatemode` (TEE, recommended) / `ovh` / `within-walls` / `local`. **Decide.** |
| `llm.model` | — | exact model id (e.g. `kimi-k2.6`, `gpt-oss-120b`, `qwen2.5:7b-instruct`). **Decide.** See `privatemode-models.md`. |
| `llm.baseURL` | (optional) | omit for local Ollama; else the route's `/v1`. |
| `language.preferred` | `nl` | `nl` / `en`. Drives the participant surface + clean/summarise language. |
| `review.mode` | `notification` | `notification` / `required-approval` (co-redactie touchpoint). |
| `aggregation.k` | — | k-anonymity threshold (typ. 4–7). **Decide** — lower = more themes, weaker anonymity. |
| `signal.escalationCategories` | all 6 | which categories route at Layer-2: crisis/child-safety/medical-emergency/abuse/safety/harassment. **Decide.** |
| `signal.destinations` | `{}` | **who** receives each routed category (D4). **Decide.** |
| `signal.passiveSupport` | `{crisis: 113…}` | passive resources always shown (e.g. crisis → 113). |

## A2. The form — ADVANCED (sensible defaults; touch when needed)

| field | default | meaning |
|---|---|---|
| `aggregation.belowThreshold` | `quarantine` | `drop` / `quarantine` (never silently drop) / `rephrase`. |
| `signal.layer1OnDevice` | `false` | on-device in-the-moment response (provisional; enable after testing). |
| `retention.ownPod` | `until-delete` | raw+cleaned retention in the participant's own pod: `until-delete` / `project-end` / `days:N`. |
| `eval.owner` / `eval.publish` | `us` / `[]` | evaluation ownership / what's published. |
| `llm.promptProfile` | (auto from model) | `verbose` (local) / `minimal` (capable). Usually auto via `MODEL_PROFILE`. |
| `llm.reasoning.label` / `.clean` / `.summarize` / `.translate` | (model default on) | per-task reasoning `on`/`off`. Recommended: `label: off` (clear), `summarize` on. |
| `llm.reasoning.effort` | (model default) | gpt-oss only: `low`/`medium`/`high`. |
| `llm.rateLimit.minIntervalMs` | `0` | space calls for a rate-limited route (Privatemode 20/min → `3200`). |
| `llm.rateLimit.maxRetries` | `3` | HTTP 429 retries (with backoff). |

> NOTE: crisis response *action* (what happens when a crisis is detected) is an OPEN question
> — see TODO "crisis response protocol" + ethics §1. Detection is built; response is not.

Per-model reasoning mechanism (applied automatically from `llm.reasoning`): Kimi
`chat_template_kwargs.thinking`, Gemma `enable_thinking`, gpt-oss `reasoning_effort`. See
`privatemode-models.md`.

## B. Env overrides (no form, e.g. the scorer/smokes — `src/ollama.js`, `src/prompt-profiles.js`)

The form fields above each have a matching env var that overrides when set (used by the scorer
and smokes, which don't build a ProjectConfig): `FP_LLM_BASEURL`, `FP_LLM_APIKEY`,
`FP_PROMPT_PROFILE`, `FP_LLM_MIN_INTERVAL_MS`, `FP_LLM_MAX_RETRIES`, `FP_LLM_THINKING` (global),
`FP_THINKING_LABEL`/`_CLEAN`/`_SUMMARIZE`/`_TRANSLATE`, `FP_LLM_REASONING_EFFORT`. Precedence:
**form (opts) → env → model default**.

## C. Deployment env (`deploy/.env`, activation, backups)

| knob | meaning |
|---|---|
| `PODS_HOST` / `ACTIVATE_HOST` | public hostnames (Caddy TLS). |
| `PRIVATEMODE_API_KEY` | the proxy's key. |
| `FP_OWNER_CLIENT_ID` / `_SECRET` / `FP_OWNER_WEBID` / `FP_PROJECT_POD` | the project-pod owner (activation service). |
| `FP_WRITER_WEBIDS` | webIds allowed to write a participant's container (e.g. the TG bot service). |
| `FP_COHORT_STORE` / `PORT` | cohort registry file / activation service port. |
| `BACKUP_INTERVAL` | backup sidecar period (s). |
| `backup-targets/*.env` (`RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, provider creds) | one file per restic target (multi-cloud). |

## D. canopy-chat surface (Vite env — `VITE_FEEDBACK_*`, set at build time)

| env var | meaning |
|---|---|
| `VITE_FEEDBACK_LLM_BASEURL` | the browser-reachable LLM route (don't ship the key in the bundle). |
| `VITE_FEEDBACK_ACTIVATION_URL` | the activation service URL (enables real participant pods). |
| `VITE_FEEDBACK_PROJECT_ID` | which project a `/feedback <code>` activates (default `canopy-chat`). |

## E. Testing / eval knobs

| knob | meaning |
|---|---|
| `FP_MODEL` | model for the scorer (`scripts/score-dataset.js`). |
| `CLEAN_MODEL` / `SUMMARIZE_MODELS` / `TRIAGE_MODEL` / `SCENARIO_MODEL` | per-smoke model selection. |
| `eval/dataset.json` + `eval/gold.json` | the scorer's frozen dataset + hand-labelled gold. |

## Done: form is the single source

The LLM runtime knobs (`promptProfile`, per-task `reasoning`, `reasoningEffort`,
`rateLimit.minIntervalMs/maxRetries`) now live in `ProjectConfig.llm` (§A2) and flow through
`configToRunOpts` to the pipeline. Env vars (§B) remain as test overrides only.
