/**
 * Db.js — better-sqlite3 wrapper for the Archive.
 *
 * Three tables:
 *   sources         — registered pod roots (name, pod_root, timestamps)
 *   resources       — every resource we've indexed (sha256, size, content-type)
 *   resource_fts    — FTS5 virtual table over (rel_path, content)
 *
 * Schema is created on `Db.open()` and is idempotent — running open() on an
 * existing DB is a no-op.  No DDL outside this file.
 *
 * The class is a thin handle: you get raw better-sqlite3 statements via
 * `db.prepare(sql)` and the underlying handle via `db.handle`, but the
 * common operations (schema, source CRUD, resource upsert, FTS upsert)
 * are exposed as methods.
 *
 * Usage:
 *   const db = Db.open(':memory:');
 *   db.addSource({ name: 'alice', podRoot: 'https://alice.example/' });
 *   db.upsertResource({ sourceId, podUri, relPath, ... });
 *   db.close();
 */
import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  pod_root      TEXT NOT NULL UNIQUE,
  added_at      INTEGER NOT NULL,
  last_indexed  INTEGER
);

CREATE TABLE IF NOT EXISTS resources (
  id            INTEGER PRIMARY KEY,
  source_id     INTEGER NOT NULL REFERENCES sources(id),
  pod_uri       TEXT NOT NULL,
  rel_path      TEXT NOT NULL,
  content_type  TEXT,
  size          INTEGER,
  sha256        TEXT NOT NULL,
  last_modified INTEGER,
  indexed_at    INTEGER NOT NULL,
  UNIQUE(source_id, pod_uri)
);
CREATE INDEX IF NOT EXISTS idx_resources_source     ON resources(source_id);
CREATE INDEX IF NOT EXISTS idx_resources_modified   ON resources(last_modified);

CREATE VIRTUAL TABLE IF NOT EXISTS resource_fts USING fts5(
  rel_path, content,
  tokenize='porter unicode61'
);
`;

export class Db {
  /**
   * Open (or create) an Archive database.
   *
   * @param {string} dbPath  filesystem path, or ':memory:' for in-memory.
   * @returns {Db}
   */
  static open(dbPath) {
    if (dbPath !== ':memory:') {
      // Ensure parent dir exists for on-disk dbs.
      try { mkdirSync(dirname(dbPath), { recursive: true }); } catch { /* ignore */ }
    }
    const handle = new Database(dbPath);
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    handle.exec(SCHEMA);
    return new Db(handle);
  }

  constructor(handle) {
    /** @type {import('better-sqlite3').Database} */
    this.handle = handle;
  }

  close() {
    this.handle.close();
  }

  // ── sources ─────────────────────────────────────────────────────────────

  /**
   * Register a new source.  Throws if `pod_root` already exists.
   * @returns {{ id: number, name: string, podRoot: string, addedAt: number, lastIndexed: number|null }}
   */
  addSource({ name, podRoot, addedAt = Date.now() }) {
    if (!name)    throw new Error('addSource: name is required');
    if (!podRoot) throw new Error('addSource: podRoot is required');
    const stmt = this.handle.prepare(
      `INSERT INTO sources (name, pod_root, added_at) VALUES (?, ?, ?)`,
    );
    const info = stmt.run(name, podRoot, addedAt);
    return {
      id:          Number(info.lastInsertRowid),
      name,
      podRoot,
      addedAt,
      lastIndexed: null,
    };
  }

  /** @returns {{id:number,name:string,podRoot:string,addedAt:number,lastIndexed:number|null}|null} */
  getSourceById(id) {
    const row = this.handle.prepare(
      `SELECT id, name, pod_root, added_at, last_indexed FROM sources WHERE id = ?`,
    ).get(id);
    return row ? this.#mapSource(row) : null;
  }

  getSourceByName(name) {
    const row = this.handle.prepare(
      `SELECT id, name, pod_root, added_at, last_indexed FROM sources WHERE name = ?`,
    ).get(name);
    return row ? this.#mapSource(row) : null;
  }

  getSourceByPodRoot(podRoot) {
    const row = this.handle.prepare(
      `SELECT id, name, pod_root, added_at, last_indexed FROM sources WHERE pod_root = ?`,
    ).get(podRoot);
    return row ? this.#mapSource(row) : null;
  }

  listSources() {
    const rows = this.handle.prepare(
      `SELECT id, name, pod_root, added_at, last_indexed FROM sources ORDER BY id ASC`,
    ).all();
    return rows.map((r) => this.#mapSource(r));
  }

  setSourceLastIndexed(sourceId, ts = Date.now()) {
    this.handle.prepare(
      `UPDATE sources SET last_indexed = ? WHERE id = ?`,
    ).run(ts, sourceId);
  }

  #mapSource(r) {
    return {
      id:          r.id,
      name:        r.name,
      podRoot:     r.pod_root,
      addedAt:     r.added_at,
      lastIndexed: r.last_indexed,
    };
  }

  // ── resources ───────────────────────────────────────────────────────────

  /**
   * Look up an existing resource row.
   * @returns {object|null}
   */
  getResource(sourceId, podUri) {
    const row = this.handle.prepare(
      `SELECT id, source_id, pod_uri, rel_path, content_type, size, sha256,
              last_modified, indexed_at
         FROM resources WHERE source_id = ? AND pod_uri = ?`,
    ).get(sourceId, podUri);
    return row ? this.#mapResource(row) : null;
  }

  /**
   * Insert or update a resource row + FTS row in a transaction.
   *
   * If `ftsContent` is null, no FTS row is written/updated (binary file).
   * Otherwise the FTS row is replaced (delete+insert) so resources can swap
   * between text and binary content types over time without leaving stale
   * FTS entries.
   *
   * @returns {{id:number, inserted:boolean}}
   */
  upsertResource({
    sourceId, podUri, relPath, contentType, size, sha256, lastModified,
    indexedAt = Date.now(),
    ftsContent,                // string|null — null means "don't index in FTS"
  }) {
    if (!sourceId) throw new Error('upsertResource: sourceId is required');
    if (!podUri)   throw new Error('upsertResource: podUri is required');
    if (!sha256)   throw new Error('upsertResource: sha256 is required');

    const tx = this.handle.transaction(() => {
      const existing = this.handle.prepare(
        `SELECT id FROM resources WHERE source_id = ? AND pod_uri = ?`,
      ).get(sourceId, podUri);

      let resourceId;
      let inserted = false;
      if (existing) {
        resourceId = existing.id;
        this.handle.prepare(
          `UPDATE resources
              SET rel_path = ?, content_type = ?, size = ?, sha256 = ?,
                  last_modified = ?, indexed_at = ?
            WHERE id = ?`,
        ).run(relPath, contentType, size, sha256, lastModified, indexedAt, resourceId);
      } else {
        const info = this.handle.prepare(
          `INSERT INTO resources
              (source_id, pod_uri, rel_path, content_type, size, sha256,
               last_modified, indexed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(sourceId, podUri, relPath, contentType, size, sha256, lastModified, indexedAt);
        resourceId = Number(info.lastInsertRowid);
        inserted = true;
      }

      // Refresh FTS row.  resource_fts is content-less FTS (default), so we
      // delete-by-rowid + insert-with-rowid to keep rowid == resources.id.
      this.handle.prepare(`DELETE FROM resource_fts WHERE rowid = ?`).run(resourceId);
      if (ftsContent !== null && ftsContent !== undefined) {
        this.handle.prepare(
          `INSERT INTO resource_fts (rowid, rel_path, content) VALUES (?, ?, ?)`,
        ).run(resourceId, relPath, String(ftsContent));
      }

      return { id: resourceId, inserted };
    });
    return tx();
  }

  /**
   * Delete a resource (and its FTS row) by id.
   */
  deleteResource(id) {
    const tx = this.handle.transaction(() => {
      this.handle.prepare(`DELETE FROM resource_fts WHERE rowid = ?`).run(id);
      this.handle.prepare(`DELETE FROM resources WHERE id = ?`).run(id);
    });
    tx();
  }

  /** Count resources, optionally scoped to a source. */
  countResources(sourceId = null) {
    if (sourceId == null) {
      return this.handle.prepare(`SELECT COUNT(*) AS n FROM resources`).get().n;
    }
    return this.handle.prepare(
      `SELECT COUNT(*) AS n FROM resources WHERE source_id = ?`,
    ).get(sourceId).n;
  }

  /** Iterate resources for a given source. */
  resourcesForSource(sourceId) {
    const rows = this.handle.prepare(
      `SELECT id, source_id, pod_uri, rel_path, content_type, size, sha256,
              last_modified, indexed_at
         FROM resources WHERE source_id = ? ORDER BY rel_path ASC`,
    ).all(sourceId);
    return rows.map((r) => this.#mapResource(r));
  }

  /** Look up a resource by pod_uri across all sources. */
  findResourceByPodUri(podUri) {
    const row = this.handle.prepare(
      `SELECT id, source_id, pod_uri, rel_path, content_type, size, sha256,
              last_modified, indexed_at
         FROM resources WHERE pod_uri = ?`,
    ).get(podUri);
    return row ? this.#mapResource(row) : null;
  }

  /** Get the FTS-indexed content for a resource id, or null if not indexed. */
  getFtsContent(resourceId) {
    const row = this.handle.prepare(
      `SELECT content FROM resource_fts WHERE rowid = ?`,
    ).get(resourceId);
    return row ? row.content : null;
  }

  #mapResource(r) {
    return {
      id:           r.id,
      sourceId:     r.source_id,
      podUri:       r.pod_uri,
      relPath:      r.rel_path,
      contentType:  r.content_type,
      size:         r.size,
      sha256:       r.sha256,
      lastModified: r.last_modified,
      indexedAt:    r.indexed_at,
    };
  }
}
