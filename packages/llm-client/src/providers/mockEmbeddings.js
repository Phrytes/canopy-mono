/**
 * Mock embeddings provider — deterministic text→vector for tests.
 *
 * Hashes each input's tokens into a small fixed-dim bag-of-words vector, then
 * L2-normalises — so the same text → the same vector, and texts that SHARE
 * tokens land closer in cosine space (semanticQuery behaves meaningfully without
 * a real model). Mirrors `mockProvider` for chat.
 */

/**
 * @param {object} [args]
 * @param {number} [args.dims=16]
 * @param {string} [args.id='mock-embeddings']
 * @param {(texts:string[]) => Promise<number[][]>} [args.embed]  full override
 * @returns {import('../types.js').EmbeddingProvider}
 */
export function mockEmbeddingsProvider({ dims = 16, id = 'mock-embeddings', embed } = {}) {
  if (typeof embed === 'function') return { id, model: id, requiresKey: false, embed };
  return {
    id,
    model: id,
    requiresKey: false,
    async embed(texts) {
      const input = Array.isArray(texts) ? texts : [texts];
      return input.map((t) => hashVec(String(t ?? ''), dims));
    },
  };
}

/** Token-bag hashed into `dims` buckets, L2-normalised. */
function hashVec(s, dims) {
  const v = new Array(dims).fill(0);
  const toks = s.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length > 1);
  for (const tok of toks) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[Math.abs(h) % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
