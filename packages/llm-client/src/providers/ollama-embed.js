/**
 * Ollama embeddings provider — text → vectors via Ollama's **batch** embed
 * endpoint `${baseUrl}/api/embed`.
 *
 * This is the native-Ollama sibling of `openaiEmbeddingsProvider`. Where the
 * OpenAI-compatible provider speaks `/v1/embeddings` (Privatemode/cloud/Ollama's
 * compat shim), this one speaks Ollama's own `/api/embed` — the batch route that
 * takes `{ model, input: string[] }` and returns `{ embeddings: number[][] }` in
 * input order. One request per batch (not one-per-text), so it satisfies the
 * §3.1 batch-first `EmbeddingProvider` contract directly.
 *
 * Works against a `localhost` Ollama AND a LAN base URL (`http://10.0.0.5:11434`)
 * — only `baseUrl` changes; the wire protocol is identical.
 *
 * Contract (§3.1):
 *   - `id` = `'ollama:' + model` (e.g. `'ollama:nomic-embed-text'`), which is the
 *     index-versioning key: store it alongside vectors and re-embed on a change.
 *   - `embed(texts) => Promise<Float32Array[]>` — one Float32Array per input.
 *   - `dim` is learned from the first response (or pass `dim` up front).
 *
 * Errors are CODES not strings (conventions/localisation.md — substrates emit
 * codes, apps localise): a transport/HTTP failure throws with
 * `code: 'E_EMBED_PROVIDER'`. Higher-level validation codes
 * (`E_EMBED_EMPTY_INPUT`, `E_EMBED_DIM_MISMATCH`) are enforced by the client
 * wrapper (`createEmbeddingsClient`).
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL    = 'nomic-embed-text';
export const OLLAMA_EMBED_DEFAULT_MODEL = DEFAULT_MODEL;

/**
 * @param {object} [args]
 * @param {string} [args.baseUrl]   host base (provider appends `/api/embed`); localhost or LAN
 * @param {string} [args.model]     embedding model id (e.g. 'nomic-embed-text', 'mxbai-embed-large')
 * @param {number} [args.dim]       vector dim if known up front (else learned from first response)
 * @param {string|null} [args.apiKey]  Bearer token for a keyed gateway (local Ollama needs none)
 * @param {object|null} [args.headers] extra headers merged into every request (auth/routing block)
 * @param {(input, init?) => Promise<Response>} [args.fetchFn]  test seam (inject a stub)
 * @param {number} [args.timeoutMs] abort a stalled endpoint (0/false disables)
 * @returns {import('../types.js').EmbeddingProvider}
 */
export function ollamaEmbedProvider({
  baseUrl   = DEFAULT_BASE_URL,
  model     = DEFAULT_MODEL,
  dim,
  apiKey    = null,
  headers   = null,
  fetchFn   = globalThis.fetch,
  timeoutMs = 12000,
} = {}) {
  if (!model) throw new TypeError('ollamaEmbedProvider: model required');
  // Accept a bare host (`http://h:11434`) or an already-`/api` route — strip a
  // trailing `/api` so both forms work without a double `/api` 404 (same spirit
  // as the openai provider's `/v1` normalisation).
  const host = String(baseUrl).replace(/\/+$/, '').replace(/\/api$/, '');
  const url  = `${host}/api/embed`;

  const provider = {
    id: `ollama:${model}`,
    model,
    endpoint: host,
    requiresKey: !!apiKey,
    // Learned lazily from the first response unless supplied up front.
    dim: Number.isInteger(dim) ? dim : undefined,
    /**
     * @param {string[]|string} texts
     * @param {{model?:string, timeoutMs?:number}} [opts]
     * @returns {Promise<Float32Array[]>}  one vector per input, in input order
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
            ...(headers && typeof headers === 'object' ? headers : {}),
          },
          // Ollama's batch shape: `input` may be a string or string[]; we always
          // send the array so N texts → N vectors in one round-trip.
          body: JSON.stringify({ model: opts.model ?? model, input }),
          ...(ctl ? { signal: ctl.signal } : {}),
        });
      } catch (err) {
        // Transport failure (DNS, refused, aborted/timeout) → provider code.
        throw Object.assign(
          new Error(`ollama-embed: ${err?.message ?? String(err)}`),
          { code: 'E_EMBED_PROVIDER', cause: err },
        );
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(
          new Error(`ollama-embed: ${res.status} ${text.slice(0, 200)}`),
          { code: 'E_EMBED_PROVIDER', status: res.status },
        );
      }
      const json    = await res.json();
      const vectors = parseOllamaEmbedResponse(json);
      // Learn the dim from the first non-empty vector (index versioning aid).
      if (provider.dim == null && vectors.length > 0 && vectors[0]) {
        provider.dim = vectors[0].length;
      }
      return vectors;
    },
  };
  return provider;
}

/**
 * Parse an Ollama `/api/embed` response → array of Float32Array in INPUT order.
 * Wire shape: `{ model, embeddings: number[][], ... }`. Ollama returns the
 * `embeddings` array aligned to the input order (no per-row index to re-sort).
 *
 * @param {object} resp
 * @returns {Float32Array[]}
 */
export function parseOllamaEmbedResponse(resp) {
  const rows = Array.isArray(resp?.embeddings) ? resp.embeddings : [];
  return rows.map((r) => (Array.isArray(r) || ArrayBuffer.isView(r) ? Float32Array.from(r) : new Float32Array(0)));
}
