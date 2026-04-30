/**
 * OpenAI provider — opt-in cloud (Q-H2.12 lock).  Same OpenAI-style
 * tool-calling path as Ollama; only the URL + auth differ.
 *
 * ⚠️  Privacy warning: enabling this sends every household chat
 * fragment classified as "freeform" to OpenAI.  Local Ollama is the
 * default for a reason — see Q-H2.12.  The CLI prints a startup
 * warning when this provider is active.
 */

import { parseOpenAIChatResponse } from './ollama.js';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL    = 'gpt-4o-mini';

/**
 * @param {object} args
 * @param {string} args.apiKey         the OpenAI API key
 * @param {string} [args.baseUrl=DEFAULT_BASE_URL]
 * @param {string} [args.model=DEFAULT_MODEL]
 * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} [args.fetchFn]
 * @returns {import('../LlmClient.js').LlmProvider}
 */
export function openaiProvider({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model   = DEFAULT_MODEL,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error('openaiProvider: apiKey required');
  return {
    id: 'openai',
    requiresKey: true,
    async invoke({ system, messages, tools }) {
      const body = {
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(Array.isArray(tools) && tools.length > 0
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: {
                  name: t.id,
                  description: t.description ?? '',
                  parameters: t.schema ?? { type: 'object', properties: {} },
                },
              })),
            }
          : {}),
      };
      const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
      const res = await fetchFn(url, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(new Error(`openai: ${res.status} ${text.slice(0, 200)}`),
          { code: 'PROVIDER_ERROR', status: res.status });
      }
      const json = await res.json();
      return parseOpenAIChatResponse(json);
    },
  };
}
