/**
 * Configurable endpoint block for @onderling/llm-client.
 *
 * Formalises endpoint selection so a deployment / customer can pick an LLM
 * endpoint (base URL + model + optional auth/header block) as first-class
 * config, instead of hand-passing `baseUrl` at every provider construction.
 * This is ADDITIVE: `ollamaProvider({baseUrl, model})` (and the embeddings
 * provider) keep working unchanged — the resolver just produces the arg bag
 * you'd otherwise write by hand.
 *
 * Config shape (`EndpointConfig`):
 *
 *   {
 *     endpoints: {
 *       local:   { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct' },
 *       enclave: { baseUrl: 'https://enclave.local',  model: 'qwen3-4b',
 *                  apiKey: 'sk-…', headers: { 'X-Tenant': 'acme' } },
 *     },
 *     default: 'local',
 *     customers: { acme: 'enclave', bob: 'local' },   // optional customer → endpoint
 *   }
 *
 * Selection order in `resolveEndpoint`:
 *   1. explicit `name`
 *   2. `customers[customerId]`
 *   3. `config.default`
 *   4. the sole endpoint, when exactly one is defined
 *
 * @typedef {object} Endpoint
 * @property {string} [name]      resolved endpoint name (added by the resolver)
 * @property {string} baseUrl
 * @property {string} [model]
 * @property {string|null} [apiKey]
 * @property {Object<string,string>} [headers]
 *
 * @typedef {object} EndpointConfig
 * @property {Object<string,Endpoint>} endpoints
 * @property {string} [default]
 * @property {Object<string,string>} [customers]
 */

/**
 * Resolve a concrete endpoint from an `EndpointConfig`.
 *
 * @param {EndpointConfig} config
 * @param {{name?: string, customerId?: string}} [selector]
 * @returns {Endpoint}  a flat arg bag `{ name, baseUrl, model, apiKey?, headers? }`
 *   ready to spread into `ollamaProvider(...)` / `openaiEmbeddingsProvider(...)`.
 */
export function resolveEndpoint(config, selector = {}) {
  if (!config || typeof config.endpoints !== 'object' || config.endpoints === null) {
    throw new TypeError('resolveEndpoint: config.endpoints object required');
  }
  const names = Object.keys(config.endpoints);
  if (names.length === 0) {
    throw new TypeError('resolveEndpoint: config.endpoints is empty');
  }

  const { name, customerId } = selector;
  let chosen =
    name ??
    (customerId != null ? config.customers?.[customerId] : undefined) ??
    config.default ??
    (names.length === 1 ? names[0] : undefined);

  if (chosen == null) {
    throw new Error(
      'resolveEndpoint: no endpoint selected — pass `name`, map the customer, ' +
      'or set config.default (multiple endpoints defined, no default)',
    );
  }

  const ep = config.endpoints[chosen];
  if (!ep) {
    throw new Error(`resolveEndpoint: unknown endpoint "${chosen}"`);
  }
  return { name: chosen, ...ep };
}
