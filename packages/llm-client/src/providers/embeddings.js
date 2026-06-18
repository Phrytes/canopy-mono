/**
 * OpenAI-compatible embeddings provider — text → vectors via the
 * `${baseUrl}/v1/embeddings` endpoint.
 *
 * The SAME wire protocol is spoken by **Privatemode** (the attested enclave —
 * model `qwen3-embedding-4b`), **Ollama** (`/v1/embeddings`, e.g. `nomic-embed-text`),
 * and any OpenAI-compatible cloud — so ONE provider serves every route; only the
 * endpoint + model (+ optional key) differ. This is the embeddings sibling of
 * `ollamaProvider` for chat: pluggable by construction, "just like the LLM system."
 *
 * **Privacy (CLAUDE.md invariant #7):** place this by the SAME trust rule as the
 * chat LLM. For sealed/confidential circles, point `baseUrl` at the attested
 * enclave (Privatemode) — NOT a plain remote. The query + items embedded here
 * carry the same exposure as sending them to the LLM that consumes the RAG
 * context, so the embedding endpoint must sit inside the same trust boundary.
 *
 * **Consistency:** index-time and query-time MUST use the SAME model (one vector
 * space) or cosine is meaningless — version the model id in whatever stores the
 * vectors, and re-index on a model change.
 */

// Privatemode's embedding model (our primary route).  Override per-route:
// Ollama → 'nomic-embed-text' / 'mxbai-embed-large', OpenAI → 'text-embedding-3-small', etc.
const DEFAULT_MODEL = 'qwen3-embedding-4b';
export const EMBEDDINGS_DEFAULT_MODEL = DEFAULT_MODEL;

/**
 * @param {object} args
 * @param {string} args.baseUrl                      host base (provider appends `/v1/embeddings`)
 * @param {string} [args.model]                      embedding model id (default qwen3-embedding-4b)
 * @param {string|null} [args.apiKey]                Bearer token for keyed routes (enclave/cloud)
 * @param {(input, init?) => Promise<Response>} [args.fetchFn]  test seam
 * @param {number} [args.timeoutMs]                  abort a stalled endpoint (0/false disables)
 * @returns {import('../types.js').EmbeddingProvider}
 */
export function openaiEmbeddingsProvider({
  baseUrl,
  model     = DEFAULT_MODEL,
  apiKey    = null,
  fetchFn   = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  if (!baseUrl) throw new TypeError('openaiEmbeddingsProvider: baseUrl required');
  // Accept either the host (`http://h:11434`) or an already-`/v1` route — strip a
  // trailing `/v1` so both forms work without a double `/v1` 404 (same convention
  // as the chat provider's normalizeBase).
  const host = String(baseUrl).replace(/\/+$/, '').replace(/\/v1$/, '');
  const url  = `${host}/v1/embeddings`;

  return {
    id: 'openai-embeddings',
    model,
    requiresKey: !!apiKey,
    /**
     * @param {string[]|string} texts
     * @param {{model?:string, timeoutMs?:number}} [opts]
     * @returns {Promise<number[][]>}  one vector per input, in input order
     */
    async embed(texts, opts = {}) {
      const input = Array.isArray(texts) ? texts : [texts];
      if (input.length === 0) return [];

      const budget = opts.timeoutMs ?? timeoutMs;
      const ctl    = budget ? new AbortController() : null;
      const timer  = ctl ? setTimeout(() => ctl.abort(), budget) : null;
      let res;
      try {
        res = await fetchFn(url, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept':       'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model: opts.model ?? model, input }),
          ...(ctl ? { signal: ctl.signal } : {}),
        });
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(new Error(`embeddings: ${res.status} ${text.slice(0, 200)}`),
          { code: 'PROVIDER_ERROR', status: res.status });
      }
      const json = await res.json();
      return parseEmbeddingsResponse(json);
    },
  };
}

/**
 * Parse an OpenAI-style embeddings response → array of vectors in INPUT order.
 * Wire shape: `{ data: [{ index, embedding: number[] }, ...] }`.  Sorts by
 * `index` when present so the output lines up with the input array.
 *
 * @param {object} resp
 * @returns {number[][]}
 */
export function parseEmbeddingsResponse(resp) {
  const data = Array.isArray(resp?.data) ? resp.data : [];
  const sorted = data.every((d) => Number.isInteger(d?.index))
    ? [...data].sort((a, b) => a.index - b.index)
    : data;
  return sorted.map((d) => (Array.isArray(d?.embedding) ? d.embedding : null));
}
