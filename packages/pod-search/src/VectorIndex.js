/**
 * VectorIndex — flat brute-force cosine over Float32Array vectors.
 *
 * V0 scope (PLAN §2 "No ANN"): one person's corpus is 10²–10⁵ chunks;
 * a linear scan is milliseconds, so no HNSW/ANN.  In-memory only —
 * persistence is Phase 52.23.
 *
 * Vectors are stored **unit-normalised** on insert, so cosine similarity
 * is a plain dot product at query time.  The index is **dimension-
 * agnostic**: the first inserted vector fixes the dimension; a later
 * insert of a different length raises `E_INDEX_MODEL_MISMATCH` (a model
 * or dim swap must go through a rebuild, not a silent mix).
 *
 * One item owns 1..N chunk vectors.  An item's similarity to a query is
 * the **max** cosine over (query chunk × item chunk) — best-matching
 * chunk wins, the standard multi-vector "any chunk hits" semantics.
 */

import { codedError } from './errors.js';

/**
 * @param {Float32Array|number[]} vec
 * @returns {Float32Array}  unit-normalised copy (zero vector → zeros)
 */
function normalise(vec) {
  const out = new Float32Array(vec.length);
  let sumSq = 0;
  for (let i = 0; i < vec.length; i += 1) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return out;
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

/** @param {Float32Array} a @param {Float32Array} b @returns {number} */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

export class VectorIndex {
  /** @type {Map<string, Float32Array[]>} unit-normalised chunk vectors per item */
  #entries = new Map();
  /** @type {number|null} */ #dim = null;

  /** @returns {number} number of items with vectors */
  get size() { return this.#entries.size; }

  /** @returns {number|null} vector dimension (null until first insert) */
  get dim() { return this.#dim; }

  /**
   * Add or replace all chunk vectors for an item.
   *
   * @param {string} id
   * @param {Array<Float32Array|number[]>} vecs
   */
  replace(id, vecs) {
    if (!vecs || vecs.length === 0) { this.#entries.delete(id); return; }
    const stored = [];
    for (const v of vecs) {
      if (this.#dim === null) this.#dim = v.length;
      else if (v.length !== this.#dim) {
        throw codedError(
          'E_INDEX_MODEL_MISMATCH',
          `VectorIndex: vector dim ${v.length} ≠ index dim ${this.#dim}`,
        );
      }
      stored.push(normalise(v));
    }
    this.#entries.set(id, stored);
  }

  /** @param {string} id */
  delete(id) { this.#entries.delete(id); }

  clear() { this.#entries.clear(); this.#dim = null; }

  /** @param {string} id @returns {Float32Array[]|undefined} stored (normalised) vectors */
  getVectors(id) { return this.#entries.get(id); }

  /**
   * Rank items by cosine similarity to the query vector(s).
   *
   * @param {Array<Float32Array|number[]>} queryVecs  one vec (semantic query) or many (similar())
   * @param {object} [opts]
   * @param {number} [opts.limit=Infinity]
   * @param {number} [opts.minScore]        drop hits below this cosine floor
   * @param {Set<string>} [opts.filterIds]  restrict to these ids (filter-then-rank)
   * @param {string} [opts.excludeId]       drop this id (for similar())
   * @returns {Array<{ id: string, score: number }>}  descending by score
   */
  search(queryVecs, { limit = Infinity, minScore, filterIds, excludeId } = {}) {
    const qs = queryVecs.map((q) => normalise(q));
    const hits = [];
    for (const [id, vecs] of this.#entries) {
      if (excludeId !== undefined && id === excludeId) continue;
      if (filterIds && !filterIds.has(id)) continue;
      let best = -Infinity;
      for (const q of qs) {
        for (const v of vecs) {
          const s = dot(q, v);
          if (s > best) best = s;
        }
      }
      if (minScore !== undefined && best < minScore) continue;
      hits.push({ id, score: best });
    }
    hits.sort((a, b) => b.score - a.score);
    return Number.isFinite(limit) ? hits.slice(0, limit) : hits;
  }
}
