/**
 * EmbeddingClient — provider-agnostic text→vector client.
 *
 * The embeddings sibling of `LlmClient`: apps construct it with an embeddings
 * provider plugin (`openaiEmbeddingsProvider` for Privatemode/Ollama/cloud, or
 * `mockEmbeddingsProvider` for tests); the client routes `embed()` through the
 * provider and runs the audit hook. Same composition pattern as the chat client,
 * so RAG embeddings (F-retrieve tier-2 semantic search) plug in exactly like the
 * LLM does.
 *
 * Privacy: the audit hook records only COUNT + DIMS, never the embedded text
 * (embeddings input can be as sensitive as the items themselves).
 *
 * Usage:
 *   import { EmbeddingClient } from '@canopy/llm-client';
 *   import { openaiEmbeddingsProvider } from '@canopy/llm-client/providers/embeddings';
 *
 *   const embedder = new EmbeddingClient({
 *     provider: openaiEmbeddingsProvider({ baseUrl, model: 'qwen3-embedding-4b' }),
 *   });
 *   const [v] = await embedder.embed(['is the milk thing still open?']);
 *
 * Per-customer usage metering (optional, same seam as LlmClient): pass a
 * `meter` sink + `customerId`. Embeddings endpoints rarely return token
 * counts, so usage is metered as requests + a char/4 estimate (completion
 * tokens are 0). Omit `meter` for byte-identical prior behaviour.
 */
import { usageForEmbedding } from './metering.js';

export class EmbeddingClient {
  /** @type {import('./types.js').EmbeddingProvider} */ #provider;
  /** @type {(entry: object) => Promise<void>|void} */ #audit;
  /** @type {import('./metering.js').MeterSink|null} */ #meter;
  #customerId; #endpoint;

  /**
   * @param {object} args
   * @param {import('./types.js').EmbeddingProvider} args.provider
   * @param {(entry: object) => Promise<void>|void} [args.audit]
   * @param {import('./metering.js').MeterSink} [args.meter]  usage sink (optional)
   * @param {string} [args.customerId]  default tenant attribution (per-call overridable)
   * @param {string} [args.endpoint]    endpoint label (defaults to provider.endpoint)
   */
  constructor({ provider, audit, meter, customerId, endpoint } = {}) {
    if (!provider || typeof provider.embed !== 'function') {
      throw new TypeError('EmbeddingClient: provider with embed() required');
    }
    this.#provider   = provider;
    this.#audit      = typeof audit === 'function' ? audit : () => {};
    this.#meter      = typeof meter === 'function' ? meter : null;
    this.#customerId = customerId ?? null;
    this.#endpoint   = endpoint ?? provider.endpoint ?? null;
  }

  /**
   * @param {string[]|string} texts
   * @param {{model?:string, timeoutMs?:number, customerId?:string, endpoint?:string}} [opts]
   * @returns {Promise<number[][]>}  one vector per input, in input order
   */
  async embed(texts, opts = {}) {
    const input = Array.isArray(texts) ? texts : [texts];
    const ts = Date.now();
    let result;
    try {
      result = await this.#provider.embed(input, opts);
    } catch (err) {
      try {
        await this.#audit({
          ts, kind: 'embed.error', providerId: this.#provider.id,
          input:  { count: input.length },                       // NB: no text (privacy)
          output: { error: err?.message ?? String(err) },
        });
      } catch { /* audit failures must never crash the agent */ }
      throw err;
    }
    try {
      await this.#audit({
        ts, kind: 'embed.ok', providerId: this.#provider.id,
        input:  { count: input.length },
        output: { count: result?.length ?? 0, dims: result?.[0]?.length ?? 0 },
      });
    } catch { /* same */ }
    if (this.#meter) {
      try {
        const usage = usageForEmbedding(input);
        this.#meter({
          customerId:       opts.customerId ?? this.#customerId,
          endpoint:         opts.endpoint   ?? this.#endpoint,
          model:            opts.model ?? this.#provider.model ?? null,
          promptTokens:     usage.promptTokens,
          completionTokens: usage.completionTokens,
          requests:         1,
          estimated:        usage.estimated,
          kind:             'embedding',
        });
      } catch { /* metering must never crash the agent */ }
    }
    return result;
  }

  /** Convenience: embed one string → one vector (or null). */
  async embedOne(text, opts) {
    const [v] = await this.embed([text], opts);
    return v ?? null;
  }

  get providerId()  { return this.#provider.id; }
  get requiresKey() { return Boolean(this.#provider.requiresKey); }
  /** The model id the provider is pinned to (for index versioning / re-embed). */
  get model()       { return this.#provider.model ?? null; }
}

/**
 * `createEmbeddingsClient` — the §3.1-named entry: the Embedder the pod-search V2
 * indexer/query path builds against. It's the same provider-agnostic + audit-hook
 * composition as `EmbeddingClient` above, but shaped to the §3.1 contract:
 *
 *   const client = createEmbeddingsClient({ provider: ollamaEmbedProvider({ ... }) });
 *   const { vectors, modelId, dim } = await client.embed(['is the milk thing open?']);
 *
 * Differences from the `EmbeddingClient` class (both are exported; existing
 * consumers of the class are untouched):
 *   - returns a `{ vectors, modelId, dim }` envelope, not a bare vector array —
 *     `modelId` is the index-versioning key, `dim` lets the caller size a store.
 *   - errors are CODES (conventions/localisation.md), never strings:
 *       · `E_EMBED_EMPTY_INPUT`  — empty array or all-blank inputs (nothing to embed)
 *       · `E_EMBED_PROVIDER`     — transport/provider failure (wraps a non-coded throw)
 *       · `E_EMBED_DIM_MISMATCH` — the provider returned vectors of inconsistent dim
 *
 * Privacy: identical to the class — the audit hook records only COUNT + DIMS,
 * never the embedded text.
 *
 * @param {object} args
 * @param {import('./types.js').EmbeddingProvider} args.provider
 * @param {(entry: object) => Promise<void>|void} [args.audit]
 * @returns {{ embed: (texts: string[], opts?: object) => Promise<{ vectors: (Float32Array|number[])[], modelId: string|null, dim: number }>, providerId: string, modelId: string|null }}
 */
export function createEmbeddingsClient({ provider, audit } = {}) {
  if (!provider || typeof provider.embed !== 'function') {
    throw new TypeError('createEmbeddingsClient: provider with embed() required');
  }
  const auditHook = typeof audit === 'function' ? audit : () => {};
  const modelId   = provider.id ?? provider.model ?? null;

  /**
   * @param {string[]|string} texts
   * @param {object} [opts]
   * @returns {Promise<{ vectors: (Float32Array|number[])[], modelId: string|null, dim: number }>}
   */
  async function embed(texts, opts = {}) {
    const input = Array.isArray(texts) ? texts : [texts];
    // Empty / all-blank input is a caller error, not an empty success — a
    // silent [] hides "you asked to embed nothing" from the indexer.
    if (input.length === 0 || input.every((t) => String(t ?? '').trim() === '')) {
      throw embedError('E_EMBED_EMPTY_INPUT', 'no non-blank text to embed');
    }

    const ts = Date.now();
    let vectors;
    try {
      vectors = await provider.embed(input, opts);
    } catch (err) {
      try {
        await auditHook({
          ts, kind: 'embed.error', providerId: provider.id,
          input:  { count: input.length },                 // NB: no text (privacy)
          output: { code: err?.code ?? 'E_EMBED_PROVIDER' },
        });
      } catch { /* audit failures must never crash the caller */ }
      // Already a coded embed error (e.g. the provider's own E_EMBED_PROVIDER) →
      // pass through; any other throw → wrap as a transport/provider failure.
      throw isEmbedError(err) ? err
        : embedError('E_EMBED_PROVIDER', err?.message ?? String(err), err);
    }

    const dim = dimOf(vectors);   // throws E_EMBED_DIM_MISMATCH on ragged output
    try {
      await auditHook({
        ts, kind: 'embed.ok', providerId: provider.id,
        input:  { count: input.length },
        output: { count: vectors?.length ?? 0, dims: dim },
      });
    } catch { /* same */ }

    return { vectors, modelId, dim };
  }

  return { embed, providerId: provider.id, modelId };
}

/** Uniform coded error (code on `.code`, per localisation.md — no user strings). */
function embedError(code, detail, cause) {
  return Object.assign(new Error(`${code}: ${detail}`), { code, ...(cause ? { cause } : {}) });
}

const EMBED_CODES = new Set(['E_EMBED_PROVIDER', 'E_EMBED_DIM_MISMATCH', 'E_EMBED_EMPTY_INPUT']);
function isEmbedError(err) { return !!err && EMBED_CODES.has(err.code); }

/**
 * All vectors must share one dim (one vector space) or cosine is meaningless.
 * Returns the common dim; throws `E_EMBED_DIM_MISMATCH` on a ragged batch.
 */
function dimOf(vectors) {
  const rows = Array.isArray(vectors) ? vectors : [];
  if (rows.length === 0) return 0;
  const dim = rows[0]?.length ?? 0;
  for (const v of rows) {
    if ((v?.length ?? 0) !== dim) {
      throw embedError('E_EMBED_DIM_MISMATCH', `expected all vectors dim=${dim}, got ${v?.length ?? 0}`);
    }
  }
  return dim;
}
