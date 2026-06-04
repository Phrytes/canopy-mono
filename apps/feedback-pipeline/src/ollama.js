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

const RAW_BASE = process.env.FP_LLM_BASEURL
  || (process.env.OLLAMA_URL ? `${process.env.OLLAMA_URL.replace(/\/+$/, '')}/v1` : 'http://localhost:11434/v1');
const BASE = RAW_BASE.replace(/\/+$/, '');
const API_KEY = process.env.FP_LLM_APIKEY || '';

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
export async function chat(model, system, user, opts = {}) {
  const { examples = [], timeoutMs = 300000, temperature = 0, numPredict = 512 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: false,
        temperature,
        max_tokens: numPredict,
        messages: [
          { role: 'system', content: system },
          ...examples,
          { role: 'user', content: user },
        ],
      }),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, ms, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = await res.json();
    return { ok: true, ms, text: (json.choices?.[0]?.message?.content ?? '').trim() };
  } catch (e) {
    const ms = Date.now() - t0;
    const error = e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(e.message || e);
    return { ok: false, ms, error };
  } finally {
    clearTimeout(timer);
  }
}

/** The active route's base URL (for diagnostics). */
export const OLLAMA_BASE = BASE;
export const LLM_BASE = BASE;
