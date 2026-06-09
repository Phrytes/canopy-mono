// LLM client — an OpenAI-compatible chat client behind a CONFIG BLOCK, so the
// LLM "route" is a `{baseURL, apiKey, model}` choice per deployment, not a code
// change (architecture §2). Every route speaks `/v1/chat/completions`:
//   • local Ollama (default)        — http://localhost:11434/v1   (no key)
//   • Privatemode (TEE)             — the localhost privatemode-proxy + project key
//   • OVH AI Endpoints              — their base URL + key
//   • within-our-walls / any OpenAI — base URL + key
//
// Configure via env (no code change): FP_LLM_BASEURL, FP_LLM_APIKEY, FP_MODEL.
// The `chat()` signature and return shape are unchanged, so every caller
// (pipeline / triage / passes) keeps working across all routes.
//
// NB this still keeps the door open to graduate to `@canopy/llm-client` (audit
// hook + usage metering) once the app joins the pnpm workspace — see
// feedback-pipeline-build-proposal-en.md.

// A host without env (the browser / canopy-chat) injects the route here. Set from the
// project config's llm block at startup; takes precedence over env when present.
let routeOverride = null;
export function setLlmRoute(route) {
  routeOverride = route?.baseURL ? { base: route.baseURL.replace(/\/+$/, ''), apiKey: route.apiKey || '' } : null;
}

// process.env only exists under Node — guard it so this module is browser-safe.
const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);

// Resolve a project's llm block to a concrete {baseURL} and install it.
//
// TWO LLM CALL SITES, two route policies (docs/MENUKAART.md §4D):
//   • AGGREGATION (Task 2) runs where the controller/enclave already holds plaintext, so the
//     privatemode proxy may be co-located there (the controller's box in Phase 1). No restriction.
//   • PER-PARTICIPANT CLEAN (Task 1) runs on RAW, pre-consent text on the participant's device —
//     it may only use a local model or privatemode to a LOOPBACK proxy / attested enclave gateway,
//     never a plain remote host. Enforced by assertCleanRouteSafe() below; the bot calls it before
//     the clean step (docs/CONFIDENTIAL-LLM-TRANSPORT.md).
const ROUTE_DEFAULT_BASE = {
  privatemode: () => env('PRIVATEMODE_PROXY_URL') || 'http://localhost:8080/v1',
  local: () => undefined,
};

// A loopback base means the privatemode proxy is co-located with the client (safe — the host the
// proxy runs on IS the participant's machine). Until the M7 enclave gateway ships, a non-loopback
// privatemode endpoint is only allowed when attestation is configured (PRIVATEMODE_ATTESTATION).
function isLoopbackBase(base) {
  if (!base) return false;
  try {
    const h = new URL(base).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch { return false; }
}
function attestationConfigured(llm = {}) {
  return Boolean(llm.attestation || env('PRIVATEMODE_ATTESTATION'));
}

export function applyLlmRoute(llm = {}) {
  const base = llm.baseURL || (ROUTE_DEFAULT_BASE[llm.route]?.() ?? undefined);
  if (['ovh', 'within-walls'].includes(llm.route) && !base) {
    throw new Error(`llm.route "${llm.route}" needs llm.baseURL (or FP_LLM_BASEURL)`);
  }
  // Footgun guard: privatemode pointed at a non-loopback host with no attestation would leak
  // raw plaintext to that host. See docs/CONFIDENTIAL-LLM-TRANSPORT.md.
  if (llm.route === 'privatemode' && base && !isLoopbackBase(base) && !attestationConfigured(llm)) {
    throw new Error(
      `llm.route "privatemode" points at a non-loopback host (${base}) with no attestation configured — ` +
      `plaintext would reach that host. Use a loopback proxy, or an attested enclave gateway ` +
      `(set PRIVATEMODE_ATTESTATION). See docs/CONFIDENTIAL-LLM-TRANSPORT.md.`);
  }
  setLlmRoute({ baseURL: base, apiKey: env('FP_LLM_APIKEY') });
  return { route: llm.route, baseURL: base || resolveRoute().base };
}

// Guard the PER-PARTICIPANT CLEAN call site: raw pre-consent text may only go to a local model or
// privatemode-to-a-safe-endpoint (loopback or attested) — never a plain remote host. Aggregation
// is NOT subject to this. The bot calls this before running Task 1 (docs/MENUKAART.md §4D).
export function assertCleanRouteSafe(llm = {}) {
  if (llm.route === 'local') return;
  if (llm.route === 'privatemode') {
    const base = llm.baseURL || ROUTE_DEFAULT_BASE.privatemode();
    if (isLoopbackBase(base) || attestationConfigured(llm)) return;
    throw new Error(`clean route "privatemode" is not safe for raw input: ${base} is non-loopback and unattested`);
  }
  throw new Error(
    `clean route "${llm.route}" would send raw pre-consent text to a remote host; ` +
    `use 'local' or attested 'privatemode' (docs/MENUKAART.md §4D)`);
}

// Resolve the route at CALL time (not import time) so the config block is dynamic
// and tests can point it at a mock server.
function resolveRoute() {
  if (routeOverride) return routeOverride;
  const raw = env('FP_LLM_BASEURL')
    || (env('OLLAMA_URL') ? `${env('OLLAMA_URL').replace(/\/+$/, '')}/v1` : 'http://localhost:11434/v1');
  return { base: raw.replace(/\/+$/, ''), apiKey: env('FP_LLM_APIKEY') || '' };
}

/**
 * One non-streaming chat completion (OpenAI-compatible).
 * @param {string} model    e.g. 'qwen2.5:7b-instruct'
 * @param {string} system   system prompt
 * @param {string} user     user message
 * @param {object} [opts]
 * @param {Array<{role:string,content:string}>} [opts.examples] few-shot turns inserted between system and user
 * @param {number} [opts.timeoutMs=300000]
 * @param {number} [opts.temperature=0]
 * @param {number} [opts.numPredict=512]   → OpenAI `max_tokens`
 * @returns {Promise<{ok:boolean, ms:number, text?:string, error?:string}>}
 */
// API usage accounting — accumulate the token usage the route reports (OpenAI `usage`
// field), so a run can show what it spent. Mirrors the Privatemode portal
// (portal.privatemode.ai/usage); the portal stays authoritative for credits, this is the
// per-run estimate. Reset between runs with resetUsage().
let _usage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
function recordUsage(u) {
  if (!u) return;
  _usage.calls += 1;
  _usage.promptTokens += u.prompt_tokens || 0;
  _usage.completionTokens += u.completion_tokens || 0;
  _usage.totalTokens += u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0));
}
export function getUsage() { return { ..._usage }; }
export function resetUsage() { _usage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional client-side throttle for rate-limited routes (e.g. Privatemode's 20 req/min):
// FP_LLM_MIN_INTERVAL_MS spaces consecutive calls. Serialized via a promise chain so
// concurrent callers queue. Default 0 = off (no behaviour change).
let _chain = Promise.resolve();
let _lastStart = 0;
function gate(minMs) {
  if (!minMs) return Promise.resolve();
  const p = _chain.then(async () => {
    const since = Date.now() - _lastStart;
    if (since < minMs) await sleep(minMs - since);
    _lastStart = Date.now();
  });
  _chain = p.catch(() => {});
  return p;
}

// Reasoning control — model-specific (Privatemode has no unified field):
//   Kimi  → chat_template_kwargs {thinking:false}
//   Gemma → chat_template_kwargs {enable_thinking:false}
//   gpt-oss → reasoning_effort (low|medium|high) — OpenAI-native; not in Privatemode's docs
//             but the OpenAI-compatible proxy may honour it. "thinking off" maps to 'low'.
// Returns the EXTRA request-body fields to merge (only ones the model accepts). Opt-in via
// opts.chatTemplateKwargs / opts.reasoningEffort / opts.thinking, or FP_LLM_THINKING /
// FP_LLM_REASONING_EFFORT. Default: model's own default (reasoning on).
function reasoningBody(model, opts = {}) {
  const m = (model || '').toLowerCase();
  const isOss = m.includes('oss'), isKimi = m.includes('kimi'), isGemma = m.includes('gemma');
  if (opts.chatTemplateKwargs) return { chat_template_kwargs: opts.chatTemplateKwargs };
  const effort = opts.reasoningEffort ?? (isOss ? env('FP_LLM_REASONING_EFFORT') : undefined);
  if (effort && isOss) return { reasoning_effort: effort };
  const thinking = opts.thinking ?? env('FP_LLM_THINKING');
  if (thinking === 'off' || thinking === false) {
    if (isKimi) return { chat_template_kwargs: { thinking: false } };
    if (isGemma) return { chat_template_kwargs: { enable_thinking: false } };
    if (isOss) return { reasoning_effort: 'low' };
  }
  return {};
}

async function postOnce({ base, apiKey, model, system, examples, user, temperature, numPredict, timeoutMs, extraBody }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: ctrl.signal,
      body: JSON.stringify({
        model, stream: false, temperature, max_tokens: numPredict,
        messages: [{ role: 'system', content: system }, ...examples, { role: 'user', content: user }],
        ...extraBody,
      }),
    });
  } finally { clearTimeout(timer); }
}

export async function chat(model, system, user, opts = {}) {
  const { examples = [], timeoutMs = 300000, temperature = 0, numPredict = 512 } = opts;
  const { base, apiKey } = resolveRoute();
  const minInterval = Number(opts.minIntervalMs ?? env('FP_LLM_MIN_INTERVAL_MS') ?? 0);   // form first, env fallback
  const maxRetries = Number(opts.maxRetries ?? env('FP_LLM_MAX_RETRIES') ?? 3);           // 429 retries only
  const extraBody = reasoningBody(model, opts);
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      await gate(minInterval);
      const res = await postOnce({ base, apiKey, model, system, examples, user, temperature, numPredict, timeoutMs, extraBody });
      if (res.status === 429 && attempt < maxRetries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30000, 1000 * 2 ** attempt));
        continue;   // rate limited — back off and retry
      }
      const ms = Date.now() - t0;
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, ms, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }
      const json = await res.json();
      recordUsage(json.usage);
      return { ok: true, ms, text: (json.choices?.[0]?.message?.content ?? '').trim(), usage: json.usage || null };
    } catch (e) {
      const ms = Date.now() - t0;
      const error = e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(e.message || e);
      return { ok: false, ms, error };
    }
  }
}

/** The active route's base URL (resolved live, for diagnostics). */
export const llmBase = () => resolveRoute().base;
export const OLLAMA_BASE = llmBase();   // import-time snapshot
export const LLM_BASE = OLLAMA_BASE;
