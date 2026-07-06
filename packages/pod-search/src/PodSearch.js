/**
 * PodSearch — substrate version.
 *
 * V0: pure-JS in-memory backend with the same public API as the
 * eventual FTS5-backed implementation.  Consumer apps integrate
 * against the API; switching to FTS5 (better-sqlite3 / expo-sqlite)
 * is a backend swap.
 *
 * Per L1i sketch + Q7: existing Archive CLI lib's FTS5 schema +
 * indexer logic informs the schema shape; the substrate ships the
 * pure-JS V0; FTS5 backend is V1.
 *
 * ── Vector layer V0 (Phase 52.22, PLAN-podsearch-v2-embeddings) ──
 * When an `embedder` (an EmbeddingProvider-shaped object, §3.1) is
 * injected and one or more fields carry `embed: true`, PodSearch also
 * maintains an in-memory cosine index and exposes semantic + hybrid
 * query modes, `similar()`, and `semanticReady`.  The embedder is
 * **injected, duck-typed** — pod-search never imports `@canopy/llm-client`
 * (substrates don't import each other; §1 layering).  Absent embedder ⇒
 * lexical-only, byte-compatible with the pre-52.22 surface.
 *
 * In-memory here; **persistence, restart-safe caches, tombstone
 * eviction, and backfill are Phases 52.23/52.24** — the `vectorStore`,
 * `hash`, and `chunking` deps are accepted and threaded as seams, but
 * this phase keeps the whole index (and the content-hash → vector cache)
 * in process memory only.
 *
 * Schema:
 *   {
 *     fields: {
 *       <field>: { primary?, fts?, weight?, facet?, sortable?, multi?, embed? }
 *     }
 *   }
 */

import { VectorIndex } from './VectorIndex.js';
import { chunkText, resolveChunking } from './chunking.js';
import { codedError } from './errors.js';

const DEFAULT_LIMIT = 50;
const RRF_K = 60; // reciprocal rank fusion constant (Q4, pre-decided)

export class PodSearch {
  /** @type {object} */ #schema;
  /** @type {Map<string, object>} */ #items = new Map();
  /** @type {string} */ #primaryField;
  /** @type {Array<{name: string, weight: number}>} */ #ftsFields;
  /** @type {string[]} */ #facetFields;
  /** @type {string[]} */ #sortableFields;

  // ── vector layer (52.22) ──
  /** @type {string[]} fields flagged `embed: true` */ #embedFields;
  /** @type {import('./chunking.js').ChunkingConfig} */ #chunking;
  /** @type {{ id: string, dim?: number, embed: (t: string[]) => Promise<Float32Array[]> } | null} */ #embedder;
  /** @type {((text: string) => Promise<string>) | null} */ #hash;
  /** @type {object | null} StorageBackend-shaped — seam for 52.23 persistence */ #vectorStore;
  /** @type {((event: object) => void) | null} */ #audit;
  /** @type {VectorIndex} */ #vectorIndex = new VectorIndex();
  /** @type {Map<string, Float32Array>} content-hash cache key → vector (in-memory only in V0) */ #vecCache = new Map();
  /** @type {string | null} modelId the current index was built with */ #indexModelId = null;

  /**
   * @param {object} args
   * @param {object} args.schema
   * @param {{ id: string, dim?: number, embed: (texts: string[]) => Promise<Float32Array[]> }} [args.embedder]
   *        optional EmbeddingProvider-shaped object (duck-typed, injected). Absent ⇒ lexical-only.
   * @param {(text: string) => Promise<string>} [args.hash]
   *        optional platform-wired SHA-256; used for the content-hash cache key. Absent ⇒ raw text is the key.
   * @param {object} [args.vectorStore]     optional StorageBackend-shaped store — seam for 52.23 persistence
   * @param {object} [args.chunking]        optional { version, maxChars, splitAt, overlap } — defaults to chunkingV1
   * @param {(event: object) => void} [args.audit]  optional audit hook (degradation events)
   * @param {object} [args.podClient]       optional — V1 will use this to read items from the pod
   * @param {string} [args.rootContainer]   optional — V1
   */
  constructor({ schema, embedder, hash, vectorStore, chunking, audit } = {}) {
    if (!schema || typeof schema.fields !== 'object') {
      throw new TypeError('PodSearch: schema.fields required');
    }
    this.#schema = schema;
    this.#primaryField = Object.entries(schema.fields)
      .find(([, def]) => def.primary)?.[0];
    if (!this.#primaryField) throw new Error('PodSearch: schema must mark one field as primary');

    this.#ftsFields = Object.entries(schema.fields)
      .filter(([, def]) => def.fts)
      .map(([name, def]) => ({ name, weight: def.weight ?? 1 }));
    this.#facetFields = Object.entries(schema.fields)
      .filter(([, def]) => def.facet)
      .map(([name]) => name);
    this.#sortableFields = Object.entries(schema.fields)
      .filter(([, def]) => def.sortable)
      .map(([name]) => name);

    // Vector layer wiring (all optional / additive).
    this.#embedFields = Object.entries(schema.fields)
      .filter(([, def]) => def.embed)
      .map(([name]) => name);
    this.#chunking = resolveChunking(chunking);
    this.#embedder = embedder ?? null;
    this.#hash = hash ?? null;
    this.#vectorStore = vectorStore ?? null; // seam — persistence is 52.23
    this.#audit = audit ?? null;
  }

  // ── indexing ────────────────────────────────────────────────────

  /**
   * Index a batch of items.  Each must have the primary field.
   *
   * When an embedder + `embed: true` fields are present, this also
   * chunks each item's embeddable text, consults the content-hash cache,
   * embeds only the misses (one batched call), and updates the vector
   * index.  Absent embedder ⇒ lexical-only, no embed call.
   *
   * @param {object[]} items
   */
  async indexBatch(items) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      const id = it[this.#primaryField];
      if (id === undefined || id === null) {
        throw new Error(`PodSearch.indexBatch: item missing primary field '${this.#primaryField}'`);
      }
      this.#items.set(id, JSON.parse(JSON.stringify(it)));
    }
    if (this.#semanticEnabled()) await this.#embedItems(items);
  }

  async deleteById(id) {
    this.#items.delete(id);
    this.#vectorIndex.delete(id); // clear the vector side too
  }

  /**
   * Wipe + rebuild the index.  V0 is in-memory so there's nothing to
   * do beyond clearing — including the vector index + cache.
   *
   * @param {object} [scope]  V1+ — selective rebuild
   */
  async reindex(/* scope */) {
    this.#items.clear();
    this.#vectorIndex.clear();
    this.#vecCache.clear();
    this.#indexModelId = null;
  }

  // ── query ───────────────────────────────────────────────────────

  /**
   * Run a search.
   *
   * The lexical surface (`mode` omitted / `'lexical'`) is unchanged and
   * byte-compatible with the pre-52.22 V0.  `'semantic'` and `'hybrid'`
   * are additive.
   *
   * @param {object} args
   * @param {string} [args.text]                  free-text query
   * @param {object} [args.filters]              {field: value | array | range}
   * @param {'relevance'|'date-desc'|'date-asc'|string} [args.rank='relevance']
   * @param {number} [args.limit=50]
   * @param {number} [args.offset=0]
   * @param {'lexical'|'semantic'|'hybrid'} [args.mode='lexical']
   * @param {number} [args.minScore]             optional semantic cosine floor
   * @returns {Promise<{items: object[], total: number, facets: object, code?: string}>}
   */
  async query({
    text,
    filters,
    rank = 'relevance',
    limit = DEFAULT_LIMIT,
    offset = 0,
    mode = 'lexical',
    minScore,
  } = {}) {
    let candidates = [...this.#items.values()];

    // Filter-then-rank: facet filters apply BEFORE ranking in every path.
    if (filters) candidates = this.#applyFilters(candidates, filters);

    let ordered;
    let code;

    if (mode === 'semantic') {
      const res = await this.#semanticRank(candidates, text, minScore);
      ordered = res.ordered;
      code = res.code;
    } else if (mode === 'hybrid') {
      ordered = await this.#hybridRank(candidates, text, rank, minScore);
    } else {
      ordered = this.#lexicalRank(candidates, text, rank);
    }

    const total  = ordered.length;
    const facets = this.#computeFacets(ordered);
    const page   = ordered.slice(offset, offset + limit).map((it) => JSON.parse(JSON.stringify(it)));

    return code ? { items: page, total, facets, code } : { items: page, total, facets };
  }

  /**
   * "More like this" — ranks other items by cosine to `id`'s STORED
   * chunk vectors.  Makes **no** embed call (the vector is already
   * indexed).  Empty result if the item has no vectors / semantic off.
   *
   * @param {string} id
   * @param {object} [opts]
   * @param {number} [opts.limit=50]
   * @returns {Promise<{items: object[], total: number, facets: object}>}
   */
  async similar(id, { limit = DEFAULT_LIMIT } = {}) {
    const vecs = this.#vectorIndex.getVectors(id);
    if (!vecs || vecs.length === 0) return { items: [], total: 0, facets: {} };
    const hits = this.#vectorIndex.search(vecs, { excludeId: id });
    const ordered = hits.map((h) => this.#items.get(h.id)).filter(Boolean);
    const facets = this.#computeFacets(ordered);
    const page = ordered.slice(0, limit).map((it) => JSON.parse(JSON.stringify(it)));
    return { items: page, total: ordered.length, facets };
  }

  /** @returns {boolean} embedder present AND the vector index is warm */
  get semanticReady() {
    return this.#semanticEnabled() && this.#vectorIndex.size > 0;
  }

  // ── ranking paths ───────────────────────────────────────────────

  /** Lexical relevance ranking — the original V0 behaviour, extracted verbatim. */
  #lexicalRank(candidates, text, rank) {
    let out = candidates;
    if (text && text.trim().length > 0) {
      const terms = this.#tokenise(text);
      out = out
        .map((item) => ({ item, score: this.#scoreItem(item, terms) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((c) => c.item);
    }
    if (rank === 'date-desc' || rank === 'date-asc') {
      out = this.#applyDateRank(out, rank);
    }
    return out;
  }

  /** IDs of the lexical ranking (relevance order) — the input to RRF. */
  #lexicalOrderIds(candidates, text) {
    return this.#lexicalRank(candidates, text, 'relevance').map((it) => it[this.#primaryField]);
  }

  /**
   * Semantic ranking: embed the query text ONCE → cosine over the
   * (filtered) indexed vectors.  Degrades gracefully:
   *   - semantic disabled → E_SEMANTIC_UNAVAILABLE-coded empty result
   *   - no query text     → empty result (nothing to embed)
   *   - embedder throws    → fall back to lexical + audit event
   */
  async #semanticRank(candidates, text, minScore) {
    if (!this.semanticReady) {
      return { ordered: [], code: 'E_SEMANTIC_UNAVAILABLE' };
    }
    if (!text || text.trim().length === 0) return { ordered: [] };

    const filterIds = new Set(candidates.map((c) => c[this.#primaryField]));
    let qvec;
    try {
      const vecs = await this.#embedder.embed([text]);
      qvec = vecs?.[0];
    } catch (err) {
      this.#audit?.({ type: 'semantic-fallback', code: 'E_EMBED_PROVIDER', error: err });
      return { ordered: this.#lexicalRank(candidates, text, 'relevance') };
    }
    if (!qvec) return { ordered: [] };

    const hits = this.#vectorIndex.search([qvec], { minScore, filterIds });
    return { ordered: hits.map((h) => this.#items.get(h.id)).filter(Boolean) };
  }

  /**
   * Hybrid ranking: reciprocal rank fusion (k=60) over the lexical
   * ranking and the cosine ranking.  Parameter-free, no score
   * normalisation.  When semantic is unavailable, hybrid silently
   * equals lexical (graceful degradation).
   */
  async #hybridRank(candidates, text, rank, minScore) {
    if (!this.semanticReady) return this.#lexicalRank(candidates, text, rank);

    const lexIds = this.#lexicalOrderIds(candidates, text);

    let semIds = [];
    if (text && text.trim().length > 0) {
      const filterIds = new Set(candidates.map((c) => c[this.#primaryField]));
      try {
        const vecs = await this.#embedder.embed([text]);
        const qvec = vecs?.[0];
        if (qvec) {
          semIds = this.#vectorIndex
            .search([qvec], { minScore, filterIds })
            .map((h) => h.id);
        }
      } catch (err) {
        this.#audit?.({ type: 'semantic-fallback', code: 'E_EMBED_PROVIDER', error: err });
        return this.#lexicalRank(candidates, text, rank);
      }
    }

    const fusedIds = rrf([lexIds, semIds], RRF_K);
    return fusedIds.map((id) => this.#items.get(id)).filter(Boolean);
  }

  // ── vector indexing ─────────────────────────────────────────────

  /** @returns {boolean} embedder injected AND at least one embeddable field */
  #semanticEnabled() {
    return !!this.#embedder && this.#embedFields.length > 0;
  }

  /**
   * Chunk each item's embeddable text, embed cache-misses in one batch,
   * and update the vector index.  Content-hash cache guarantees an
   * unchanged chunk is never re-embedded.
   */
  async #embedItems(items) {
    const modelId = this.#embedder.id;
    if (this.#indexModelId && this.#indexModelId !== modelId && this.#vectorIndex.size > 0) {
      throw codedError(
        'E_INDEX_MODEL_MISMATCH',
        `PodSearch: index built with '${this.#indexModelId}', embedder is '${modelId}'`,
      );
    }

    // Chunk every item + compute its cache keys; collect the misses.
    const perItem = [];
    const missTexts = [];
    const missKeys = [];
    const seenMiss = new Set();
    for (const it of items) {
      const id = it[this.#primaryField];
      const text = this.#embeddableText(it);
      const chunks = chunkText(text, this.#chunking);
      const keyed = [];
      for (const chunk of chunks) {
        const key = await this.#cacheKey(modelId, chunk);
        keyed.push({ chunk, key });
        if (!this.#vecCache.has(key) && !seenMiss.has(key)) {
          seenMiss.add(key);
          missTexts.push(chunk);
          missKeys.push(key);
        }
      }
      perItem.push({ id, keyed });
    }

    // Embed only the misses — one batched call.
    if (missTexts.length > 0) {
      const vecs = await this.#embedder.embed(missTexts);
      if (!Array.isArray(vecs) || vecs.length !== missTexts.length) {
        throw codedError('E_EMBED_PROVIDER', 'PodSearch: embedder returned wrong vector count');
      }
      for (let i = 0; i < vecs.length; i += 1) {
        const v = vecs[i];
        if (this.#embedder.dim !== undefined && v.length !== this.#embedder.dim) {
          throw codedError(
            'E_INDEX_MODEL_MISMATCH',
            `PodSearch: embedder returned dim ${v.length}, declared ${this.#embedder.dim}`,
          );
        }
        this.#vecCache.set(missKeys[i], v);
      }
    }

    // Assign vectors to items (VectorIndex enforces a consistent dim).
    for (const { id, keyed } of perItem) {
      const vecs = keyed.map(({ key }) => this.#vecCache.get(key));
      this.#vectorIndex.replace(id, vecs);
    }
    this.#indexModelId = modelId;
  }

  /** Concatenation of the item's `embed: true` fields (skips empties). */
  #embeddableText(item) {
    return this.#embedFields
      .map((f) => item[f])
      .filter((v) => v !== undefined && v !== null && String(v).trim().length > 0)
      .map((v) => String(v))
      .join('\n\n');
  }

  /**
   * Cache key for "may I reuse this vector?": `${modelId}:${chunkingV}:${hash(text)}`.
   * `hash` is optional in V0 — absent, the raw chunk text is the key
   * (still deterministic; persistence phase wires a real SHA-256).
   */
  async #cacheKey(modelId, text) {
    const h = this.#hash ? await this.#hash(text) : text;
    return `${modelId}:${this.#chunking.version}:${h}`;
  }

  // ── helpers ─────────────────────────────────────────────────────

  #applyDateRank(items, rank) {
    const dateField = this.#sortableFields.find((f) => f.toLowerCase().includes('time') || f.toLowerCase().includes('date'))
      ?? this.#sortableFields[0];
    if (!dateField) return items;
    return [...items].sort((a, b) =>
      rank === 'date-desc'
        ? (b[dateField] ?? 0) - (a[dateField] ?? 0)
        : (a[dateField] ?? 0) - (b[dateField] ?? 0),
    );
  }

  #applyFilters(items, filters) {
    return items.filter((item) => {
      for (const [field, spec] of Object.entries(filters)) {
        if (spec === undefined) continue;
        const value = item[field];
        if (Array.isArray(spec)) {
          // Multi-value match: include if item value (or any element of multi-value field) intersects.
          const wanted = new Set(spec);
          if (Array.isArray(value)) {
            if (!value.some((v) => wanted.has(v))) return false;
          } else {
            if (!wanted.has(value)) return false;
          }
        } else if (spec && typeof spec === 'object' && ('from' in spec || 'to' in spec)) {
          if (spec.from !== undefined && (value ?? -Infinity) < spec.from) return false;
          if (spec.to   !== undefined && (value ??  Infinity) > spec.to)   return false;
        } else {
          if (Array.isArray(value)) {
            if (!value.includes(spec)) return false;
          } else {
            if (value !== spec) return false;
          }
        }
      }
      return true;
    });
  }

  #tokenise(text) {
    return text
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
      .filter(Boolean);
  }

  #scoreItem(item, terms) {
    const matchedTerms = new Set();
    let score = 0;
    for (const { name, weight } of this.#ftsFields) {
      const haystack = (item[name] ?? '').toString().toLowerCase();
      if (!haystack) continue;
      let fieldAllMatched = true;
      for (const term of terms) {
        if (haystack.includes(term)) {
          matchedTerms.add(term);
          score += weight;
        } else {
          fieldAllMatched = false;
        }
      }
      // Bonus for matching all terms in one field (boosts "whole
      // phrase in title" over "spread across fields").
      if (fieldAllMatched) score += weight * 0.5;
    }
    // AND semantics: every query term must match in some fts field.
    if (matchedTerms.size < terms.length) return 0;
    return score;
  }

  #computeFacets(items) {
    const facets = {};
    for (const field of this.#facetFields) {
      const counts = {};
      for (const item of items) {
        const value = item[field];
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const v of value) counts[v] = (counts[v] ?? 0) + 1;
        } else {
          counts[value] = (counts[value] ?? 0) + 1;
        }
      }
      facets[field] = counts;
    }
    return facets;
  }

  /** @returns {number} number of indexed items */
  get size() { return this.#items.size; }
}

/**
 * Reciprocal rank fusion.  score(id) = Σ 1/(k + rank) over the rankings
 * the id appears in (rank is 1-based).  Parameter-free fusion of the
 * lexical and cosine orderings — no score normalisation.
 *
 * @param {string[][]} rankings  each an ordered id list (best first)
 * @param {number} k
 * @returns {string[]}  fused id order (best first)
 */
function rrf(rankings, k = RRF_K) {
  const scores = new Map();
  for (const ids of rankings) {
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
