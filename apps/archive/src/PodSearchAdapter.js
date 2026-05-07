/**
 * PodSearchAdapter — exposes Archive's FTS5-backed Db + Search through
 * @canopy/pod-search's L1i public API.
 *
 * Purpose: rule-of-two validation for L1i.  L1i shipped with a pure-JS
 * in-memory backend; this adapter shows whether L1i's API surface
 * holds up against a real FTS5 backend.  Findings (in
 * `test/PodSearchAdapter.test.js` and at the bottom of this file)
 * drive L1i V1.
 *
 * Methods conform to L1i's PodSearch shape:
 *   - indexBatch(items)
 *   - deleteById(id)              (id = resourceId)
 *   - reindex(scope?)             (no-op for FTS5; index updates are
 *                                   incremental at upsert time)
 *   - query({text, filters?, rank?, limit?, offset?})
 */

import { Db } from './Db.js';
import { search } from './Search.js';

export class PodSearchAdapter {
  /** @type {Db} */
  #db;
  /** @type {number|null} */
  #defaultSourceId;

  /**
   * @param {object} args
   * @param {Db} args.db
   * @param {number} [args.defaultSourceId]
   *   When indexBatch items don't carry their own sourceId, fall back to this.
   */
  constructor({ db, defaultSourceId }) {
    if (!db) throw new TypeError('PodSearchAdapter: db required');
    this.#db = db;
    this.#defaultSourceId = defaultSourceId ?? null;
  }

  /**
   * Index a batch of items.  Each item maps to one row in `resources`
   * + (when content is present + FTS-eligible) one row in `resource_fts`.
   *
   * @param {Array<{
   *   podUri: string,
   *   relPath: string,
   *   content?: string,
   *   contentType?: string,
   *   sha256: string,
   *   size?: number,
   *   lastModified?: number,
   *   sourceId?: number,
   * }>} items
   */
  async indexBatch(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const sourceId = item.sourceId ?? this.#defaultSourceId;
      if (sourceId == null) {
        throw new Error(
          'PodSearchAdapter.indexBatch: each item needs sourceId, or set defaultSourceId on the adapter',
        );
      }
      this.#db.upsertResource({
        sourceId,
        podUri:       item.podUri,
        relPath:      item.relPath,
        contentType:  item.contentType ?? null,
        size:         item.size ?? null,
        sha256:       item.sha256,
        lastModified: item.lastModified ?? null,
        ftsContent:   typeof item.content === 'string' ? item.content : null,
      });
    }
  }

  /**
   * Delete by resourceId.
   *
   * @param {number} id
   */
  async deleteById(id) {
    this.#db.deleteResource(id);
  }

  /**
   * No-op for FTS5 — index updates happen incrementally at upsert
   * time.  Substrate's `reindex` is a wipe+rebuild contract, but
   * Archive doesn't support that without re-fetching from the pod.
   * Documented gap for V1: substrate should distinguish "wipe" from
   * "no-op for incremental backends."
   */
  async reindex() {
    // intentionally empty
  }

  /**
   * Query — text + optional filters.  Returns L1i's
   * `{items, total, facets}` shape.
   *
   * Differences from L1i's pure-JS backend:
   *   - text queries use FTS5 MATCH grammar (richer than substring).
   *   - filters: V0 supports `sourceId` (Archive's data model);
   *     `contentType` filter is also expressible by post-filtering the
   *     result set client-side.  L1i's full filter language (multi-value,
   *     range) is partially supported.
   *   - rank: L1i's relevance rank ↔ Archive's FTS5 `rank`; date
   *     ranks aren't supported (Archive's existing search() doesn't
   *     order by lastModified — V1 work).
   *   - facets: substrate computes facets over the result set; we
   *     compute over the FTS5 result rows (sourceName + contentType).
   *
   * @param {{
   *   text?: string,
   *   filters?: object,
   *   rank?: string,
   *   limit?: number,
   *   offset?: number,
   * }} args
   */
  async query({ text, filters, rank, limit, offset } = {}) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      // Substrate API gap: L1i allows queries without text (filter-only
      // listing).  Archive's search() requires a non-empty MATCH; FTS5
      // doesn't index unmatched columns.  V1 substrate work: distinguish
      // "search" from "list" or document this as a backend capability.
      throw Object.assign(
        new Error('PodSearchAdapter.query: text required (Archive FTS5 backend gap; V1 substrate work)'),
        { code: 'BAD_REQUEST' },
      );
    }
    if (rank && rank !== 'relevance') {
      // Archive's search() doesn't support date-desc/asc ordering; V1.
      throw Object.assign(
        new Error(`PodSearchAdapter.query: rank='${rank}' unsupported (V1 — Archive search() orders by FTS5 rank only)`),
        { code: 'BAD_REQUEST' },
      );
    }

    const sourceId = filters?.sourceId ?? null;
    const allRows  = search(this.#db, text, {
      limit:    Math.max(limit ?? 50, 1) + (offset ?? 0),
      sourceId,
    });

    // Apply remaining client-side filters (contentType etc).
    let filtered = allRows;
    if (filters?.contentType) {
      const types = Array.isArray(filters.contentType)
        ? new Set(filters.contentType)
        : new Set([filters.contentType]);
      filtered = filtered.filter((r) => types.has(r.contentType));
    }

    const total  = filtered.length;
    const facets = total > 0 ? {
      sourceName:  countByField(filtered, 'sourceName'),
      contentType: countByField(filtered, 'contentType'),
    } : {};

    const start = offset ?? 0;
    const end   = start + (limit ?? 50);
    const page  = filtered.slice(start, end);

    return { items: page, total, facets };
  }
}

function countByField(rows, field) {
  const counts = {};
  for (const r of rows) {
    const v = r[field];
    if (v === undefined || v === null) continue;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}
