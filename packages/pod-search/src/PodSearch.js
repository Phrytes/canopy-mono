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
 * Schema:
 *   {
 *     fields: {
 *       <field>: { primary?, fts?, weight?, facet?, sortable?, multi? }
 *     }
 *   }
 */

const DEFAULT_LIMIT = 50;

export class PodSearch {
  /** @type {object} */ #schema;
  /** @type {Map<string, object>} */ #items = new Map();
  /** @type {string} */ #primaryField;
  /** @type {Array<{name: string, weight: number}>} */ #ftsFields;
  /** @type {string[]} */ #facetFields;
  /** @type {string[]} */ #sortableFields;

  /**
   * @param {object} args
   * @param {object} args.schema
   * @param {object} [args.podClient]    optional — V1 will use this to read items from the pod
   * @param {string} [args.rootContainer] optional — V1
   */
  constructor({ schema /* , podClient, rootContainer */ }) {
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
  }

  // ── indexing ────────────────────────────────────────────────────

  /**
   * Index a batch of items.  Each must have the primary field.
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
  }

  async deleteById(id) {
    this.#items.delete(id);
  }

  /**
   * Wipe + rebuild the index.  V0 is in-memory so there's nothing to
   * do beyond clearing.
   *
   * @param {object} [scope]  V1+ — selective rebuild
   */
  async reindex(/* scope */) {
    this.#items.clear();
  }

  // ── query ───────────────────────────────────────────────────────

  /**
   * Run a search.
   *
   * @param {object} args
   * @param {string} [args.text]                  free-text query
   * @param {object} [args.filters]              {field: value | array | range}
   * @param {'relevance'|'date-desc'|'date-asc'|string} [args.rank='relevance']
   * @param {number} [args.limit=50]
   * @param {number} [args.offset=0]
   * @returns {Promise<{items: object[], total: number, facets: object}>}
   */
  async query({
    text,
    filters,
    rank = 'relevance',
    limit = DEFAULT_LIMIT,
    offset = 0,
  } = {}) {
    let candidates = [...this.#items.values()];

    // Apply filters first.
    if (filters) candidates = this.#applyFilters(candidates, filters);

    // Compute relevance scores when text query is present.
    if (text && text.trim().length > 0) {
      const terms = this.#tokenise(text);
      candidates = candidates
        .map((item) => ({ item, score: this.#scoreItem(item, terms) }))
        .filter((c) => c.score > 0);
      // Default rank for text queries is relevance.
      candidates.sort((a, b) => b.score - a.score);
      candidates = candidates.map((c) => c.item);
    }

    // Apply rank for non-text or override.
    if (rank === 'date-desc' || rank === 'date-asc') {
      const dateField = this.#sortableFields.find((f) => f.toLowerCase().includes('time') || f.toLowerCase().includes('date'))
        ?? this.#sortableFields[0];
      if (dateField) {
        candidates.sort((a, b) =>
          rank === 'date-desc'
            ? (b[dateField] ?? 0) - (a[dateField] ?? 0)
            : (a[dateField] ?? 0) - (b[dateField] ?? 0),
        );
      }
    }

    const total  = candidates.length;
    const facets = this.#computeFacets(candidates);

    const page = candidates.slice(offset, offset + limit).map((it) => JSON.parse(JSON.stringify(it)));

    return { items: page, total, facets };
  }

  // ── helpers ─────────────────────────────────────────────────────

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
