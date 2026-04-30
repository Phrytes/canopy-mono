/**
 * Ollama provider — local LLM via the Ollama REST API.
 *
 * Default H2 production target per Q-H2.10 lock (Mac mini M2 16 GB
 * with `ollama serve`).  Default model: `qwen2.5:3b-instruct`.
 *
 * Wire format: Ollama exposes an OpenAI-compatible chat-completions
 * endpoint at `${baseUrl}/v1/chat/completions`.  We use that path so
 * the same code works against any OpenAI-compatible backend (vLLM,
 * llama.cpp's server mode, LM Studio, etc.).
 *
 * Tool calls: Ollama-the-server passes tools through to the model;
 * compatible models (Qwen 2.5, Llama 3.x in some variants) emit
 * structured `tool_calls` in the response.  For models that don't
 * tool-call natively, the system prompt asks for raw JSON output and
 * we parse manually — see `parseLooseToolCall` for the fallback.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL    = 'qwen2.5:3b-instruct';

/**
 * @param {object} [args]
 * @param {string} [args.baseUrl=DEFAULT_BASE_URL]
 * @param {string} [args.model=DEFAULT_MODEL]
 * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} [args.fetchFn]
 *   Test seam.  Defaults to globalThis.fetch.
 * @returns {import('../LlmClient.js').LlmProvider}
 */
export function ollamaProvider({
  baseUrl = DEFAULT_BASE_URL,
  model   = DEFAULT_MODEL,
  fetchFn = globalThis.fetch,
} = {}) {
  return {
    id: 'ollama',
    requiresKey: false,
    async invoke({ system, messages, tools }) {
      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          ...messages,
        ],
        ...(Array.isArray(tools) && tools.length > 0
          ? { tools: tools.map(toOpenAITool) }
          : {}),
        stream: false,
      };
      const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
      const res = await fetchFn(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(new Error(`ollama: ${res.status} ${text.slice(0, 200)}`),
          { code: 'PROVIDER_ERROR', status: res.status });
      }
      const json = await res.json();
      return parseOpenAIChatResponse(json);
    },
  };
}

/**
 * Translate our `ToolDescriptor` to OpenAI's tool-spec shape.
 * @param {import('../../types.js').ToolDescriptor} t
 */
function toOpenAITool(t) {
  return {
    type: 'function',
    function: {
      name:        t.id,
      description: t.description ?? '',
      parameters:  t.schema ?? { type: 'object', properties: {} },
    },
  };
}

/**
 * Parse an OpenAI-style chat-completion response and return our
 * normalised `LlmInvocationResult`.  Defensively handles models that
 * don't tool-call natively (falls through to text parsing via
 * `parseLooseToolCall`).
 *
 * @param {object} resp
 * @returns {import('../LlmClient.js').LlmInvocationResult}
 */
export function parseOpenAIChatResponse(resp) {
  const choice = resp?.choices?.[0];
  const msg    = choice?.message ?? {};

  // Native tool-call (OpenAI / Qwen / Llama in tool-call mode).
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    const tc = msg.tool_calls[0];
    let args = {};
    try { args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments ?? {}); }
    catch { args = {}; }
    return {
      toolCall:       { id: tc.function?.name ?? '', args },
      classification: 'actionable',
      replyText:      null,
      raw:            resp,
    };
  }

  // Text content — try the loose JSON-blob fallback before treating
  // the message as plain reply.
  const text = (msg.content ?? '').trim();
  const loose = parseLooseToolCall(text);
  if (loose) {
    return { toolCall: loose, classification: 'actionable', replyText: null, raw: resp };
  }
  // Heuristic: if the model wrote `"noise"` or `"classification": "noise"`,
  // treat as noise.  Otherwise it's a free reply.
  const lower = text.toLowerCase();
  if (lower === 'noise' || /["']?classification["']?\s*:\s*["']noise["']/.test(lower)) {
    return { toolCall: null, classification: 'noise', replyText: null, raw: resp };
  }
  return { toolCall: null, classification: null, replyText: text || null, raw: resp };
}

/**
 * Loose tool-call extractor for models that emit a JSON blob in the
 * text content instead of using the tool_calls protocol.  Looks for
 * an object with `tool` + `args` keys, e.g.
 *   {"tool": "addItem", "args": {"type": "shopping", "text": "bread"}}
 *
 * Returns null if no plausible tool call is present.
 *
 * @param {string} text
 * @returns {{ id: string, args: object } | null}
 */
export function parseLooseToolCall(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.tool === 'string' && typeof obj.args === 'object' && obj.args !== null) {
      return { id: obj.tool, args: obj.args };
    }
  } catch { /* fall through */ }
  return null;
}
