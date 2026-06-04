// Tiny Ollama HTTP client — just enough for the smoke scripts.
//
// Deliberately dependency-free and self-contained so the experiment runs
// with zero `npm install`. When this graduates into a real app it should
// swap to `@canopy/llm-client` (LlmClient.invoke({system, messages}) with
// no `tools` → result.replyText) — see ../docs/PLAN-tomorrow-tg-pod.md.

const BASE = process.env.OLLAMA_URL || 'http://localhost:11434';

/**
 * One non-streaming chat completion at temperature 0.
 * @param {string} model    e.g. 'qwen2.5:7b-instruct'
 * @param {string} system   system prompt
 * @param {string} user     user message
 * @param {object} [opts]
 * @param {Array<{role:string,content:string}>} [opts.examples] few-shot turns inserted between system and user
 * @param {number} [opts.timeoutMs=300000]
 * @param {number} [opts.temperature=0]
 * @returns {Promise<{ok:boolean, ms:number, text?:string, error?:string}>}
 */
export async function chat(model, system, user, opts = {}) {
  const { examples = [], timeoutMs = 300000, temperature = 0, numPredict = 512 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature, num_predict: numPredict },
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
    return { ok: true, ms, text: (json.message?.content ?? '').trim() };
  } catch (e) {
    const ms = Date.now() - t0;
    const error = e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(e.message || e);
    return { ok: false, ms, error };
  } finally {
    clearTimeout(timer);
  }
}

export const OLLAMA_BASE = BASE;
