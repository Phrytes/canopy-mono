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
