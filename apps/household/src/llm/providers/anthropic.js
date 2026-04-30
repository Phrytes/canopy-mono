/**
 * Anthropic provider — opt-in cloud (Q-H2.12 lock).  Different wire
 * format from OpenAI/Ollama; we translate.
 *
 * Same privacy warning as OpenAI provider applies — see openai.js.
 */

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL    = 'claude-haiku-4-5-20251001';

/**
 * @param {object} args
 * @param {string} args.apiKey
 * @param {string} [args.baseUrl=DEFAULT_BASE_URL]
 * @param {string} [args.model=DEFAULT_MODEL]
 * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} [args.fetchFn]
 * @returns {import('../LlmClient.js').LlmProvider}
 */
export function anthropicProvider({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model   = DEFAULT_MODEL,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error('anthropicProvider: apiKey required');
  return {
    id: 'anthropic',
    requiresKey: true,
    async invoke({ system, messages, tools }) {
      // Anthropic's messages API is different in shape:
      //   - `system` is a top-level field, not a message role.
      //   - Tools live under `tools: [{ name, description, input_schema }]`.
      //   - The response uses `stop_reason: 'tool_use'` + a `tool_use` content block.
      const body = {
        model,
        max_tokens: 1024,
        system,
        messages,
        ...(Array.isArray(tools) && tools.length > 0
          ? {
              tools: tools.map((t) => ({
                name:         t.id,
                description:  t.description ?? '',
                input_schema: t.schema ?? { type: 'object', properties: {} },
              })),
            }
          : {}),
      };
      const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
      const res = await fetchFn(url, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'Accept':            'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(new Error(`anthropic: ${res.status} ${text.slice(0, 200)}`),
          { code: 'PROVIDER_ERROR', status: res.status });
      }
      const json = await res.json();
      return parseAnthropicResponse(json);
    },
  };
}

/**
 * Translate Anthropic's response to our normalised shape.
 * @param {object} resp
 * @returns {import('../LlmClient.js').LlmInvocationResult}
 */
export function parseAnthropicResponse(resp) {
  const blocks = Array.isArray(resp?.content) ? resp.content : [];
  // Tool-use block?
  const toolBlock = blocks.find((b) => b?.type === 'tool_use');
  if (toolBlock) {
    return {
      toolCall:       { id: toolBlock.name ?? '', args: toolBlock.input ?? {} },
      classification: 'actionable',
      replyText:      null,
      raw:            resp,
    };
  }
  // Text block.
  const textBlock = blocks.find((b) => b?.type === 'text');
  const text = (textBlock?.text ?? '').trim();
  if (!text) return { toolCall: null, classification: null, replyText: null, raw: resp };
  if (text.toLowerCase() === 'noise') {
    return { toolCall: null, classification: 'noise', replyText: null, raw: resp };
  }
  return { toolCall: null, classification: null, replyText: text, raw: resp };
}
