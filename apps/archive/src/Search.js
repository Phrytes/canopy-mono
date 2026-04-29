/**
 * Search.js — query helpers over the FTS5 index.
 *
 * The schema:
 *   resource_fts(rel_path, content)  rowid maps 1:1 to resources.id.
 *
 * We always join back to `resources` so the result includes pod_uri,
 * source name, last_modified, etc.  All inputs are bound — never
 * concatenated — so a malicious query string can't escape the FTS5 grammar
 * outside the MATCH operand (and FTS5's MATCH grammar is itself sandboxed
 * by the parser; we still treat user input as opaque).
 */

const DEFAULT_LIMIT = 20;
const DEFAULT_SNIPPET_TOKEN_BUDGET = 12;

/**
 * Run a full-text search.  Results are ordered by FTS5 `rank`.
 *
 * @param {import('./Db.js').Db} db
 * @param {string} query                    raw FTS5 MATCH expression
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {number|null} [opts.sourceId]     filter to one source
 * @returns {Array<{
 *   resourceId: number,
 *   sourceId:   number,
 *   sourceName: string,
 *   podUri:     string,
 *   relPath:    string,
 *   contentType:string,
 *   size:       number,
 *   sha256:     string,
 *   lastModified:number,
 *   indexedAt:  number,
 *   rank:       number,
 *   snippet:    string,
 * }>}
 */
export function search(db, query, opts = {}) {
  if (!db)                            throw new Error('search: db is required');
  if (typeof query !== 'string')      throw new Error('search: query must be a string');
  if (query.trim().length === 0)      throw new Error('search: query cannot be empty');

  const limit    = Math.max(1, Math.min(1000, opts.limit ?? DEFAULT_LIMIT));
  const sourceId = opts.sourceId ?? null;

  // FTS5 snippet():
  //   snippet(table, column-index, start-mark, end-mark, ellipsis, token-count)
  //
  // We snippet the `content` column (index 1) with a small token budget.
  const budget = DEFAULT_SNIPPET_TOKEN_BUDGET;

  const params = { q: query, limit };
  let sql = `
    SELECT  r.id            AS resourceId,
            r.source_id     AS sourceId,
            s.name          AS sourceName,
            r.pod_uri       AS podUri,
            r.rel_path      AS relPath,
            r.content_type  AS contentType,
            r.size          AS size,
            r.sha256        AS sha256,
            r.last_modified AS lastModified,
            r.indexed_at    AS indexedAt,
            resource_fts.rank AS rank,
            snippet(resource_fts, 1, '[', ']', '…', ${budget}) AS snippet
      FROM  resource_fts
      JOIN  resources r ON r.id = resource_fts.rowid
      JOIN  sources   s ON s.id = r.source_id
     WHERE  resource_fts MATCH @q
  `;
  if (sourceId != null) {
    sql += ` AND r.source_id = @sourceId `;
    params.sourceId = sourceId;
  }
  sql += ` ORDER BY rank LIMIT @limit `;

  return db.handle.prepare(sql).all(params);
}

/**
 * Resolve a pod URI to its resources row (or null).  Used by `archive show`.
 */
export function findByPodUri(db, podUri) {
  return db.findResourceByPodUri(podUri);
}
