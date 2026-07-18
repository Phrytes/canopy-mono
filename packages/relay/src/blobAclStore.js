/**
 * BlobAclStore — the server-side membership-grant record for the blob-gate
 * edge (PLAN-media-infra-deployment).
 *
 * @abstract
 *
 * The blob-gateway poortwachter is deny-by-default: a reader only gets a
 * presigned URL when `acl.canRead(webId, ref)` returns exactly `true`. This
 * store IS that ACL on the relay: a durable (key → granted actors) record,
 * written by the authenticated `/grant` route (grant-on-upload v1 — the
 * uploader grants the circle members at upload time) and read by the gate.
 *
 * `key` is the OPAQUE ref string the reader will present (a `blob://<bucketKey>`
 * ref in practice — the store never parses it); `actorId` is whatever the
 * injected `verifyToken` returns as `webId`. The store matches them verbatim.
 *
 * Implementations mirror the queue-store pattern (`src/queueStores/`):
 * MemoryBlobAclStore (tests/default), SqliteBlobAclStore (production v1 —
 * better-sqlite3, same file/db conventions as `SqliteQueueStore`).
 */
export class BlobAclStore {
  /** Record that `actorId` may read `key`. Idempotent. */
  async grant(key, actorId) { throw new Error('BlobAclStore.grant() not implemented'); }

  /** Record a batch of grants for one key (grant-on-upload fan-out). Idempotent. */
  async grantMany(key, actorIds) { throw new Error('BlobAclStore.grantMany() not implemented'); }

  /**
   * Deny-by-default membership check.  NOTE the argument order matches the
   * gatekeeper's `acl.canRead(webId, ref)` — actor first, key second.
   * @returns {Promise<boolean>} strictly `true` only for a recorded grant.
   */
  async check(actorId, key) { throw new Error('BlobAclStore.check() not implemented'); }

  /** Drop every grant for `key` (e.g. blob deleted). Idempotent. */
  async revokeKey(key) { throw new Error('BlobAclStore.revokeKey() not implemented'); }

  /** Idempotent close hook. */
  async close() { /* no-op by default */ }
}

/**
 * MemoryBlobAclStore — in-process implementation of `BlobAclStore`.
 *
 * Shipped for tests + as the default backing when a relay is started without
 * an injected ACL. Not durable across restarts; for that, use
 * `SqliteBlobAclStore`.
 */
export class MemoryBlobAclStore extends BlobAclStore {
  /** key → Set<actorId> */
  #grants = new Map();

  async grant(key, actorId) {
    if (!this.#grants.has(key)) this.#grants.set(key, new Set());
    this.#grants.get(key).add(actorId);
  }

  async grantMany(key, actorIds) {
    for (const actorId of actorIds ?? []) await this.grant(key, actorId);
  }

  async check(actorId, key) {
    return this.#grants.get(key)?.has(actorId) === true;
  }

  async revokeKey(key) {
    this.#grants.delete(key);
  }

  async close() {
    this.#grants.clear();
  }
}

/* ── SQLite backing ─────────────────────────────────────────────────────────── */

import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blob_acl (
  key       TEXT    NOT NULL,
  actorId   TEXT    NOT NULL,
  grantedAt INTEGER NOT NULL,        -- unix-ms, bookkeeping only
  PRIMARY KEY (key, actorId)
);
`;

/**
 * SqliteBlobAclStore — durable, single-process `BlobAclStore` backed by SQLite.
 *
 * Uses `better-sqlite3` (synchronous C bindings).  Method bodies run
 * synchronously, but the surface stays `async` to match the `BlobAclStore`
 * interface so callers can swap in async-native stores (Redis, Postgres, …).
 *
 * Tests can pass `path: ':memory:'` to avoid touching disk; production
 * passes a filesystem path (e.g. `./relay-blob-acl.sqlite`).
 */
export class SqliteBlobAclStore extends BlobAclStore {
  #db;
  #stmts;

  /**
   * @param {object} [opts]
   * @param {string} [opts.path=':memory:']  SQLite file path, or `:memory:` for ephemeral.
   */
  constructor({ path = ':memory:' } = {}) {
    super();
    this.#db = new Database(path);
    this.#db.pragma('journal_mode = WAL');
    this.#db.exec(SCHEMA);
    this.#stmts = {
      insertGrant: this.#db.prepare(`
        INSERT OR IGNORE INTO blob_acl (key, actorId, grantedAt) VALUES (?, ?, ?)
      `),
      selectGrant: this.#db.prepare(`SELECT 1 FROM blob_acl WHERE key = ? AND actorId = ?`),
      deleteKey:   this.#db.prepare(`DELETE FROM blob_acl WHERE key = ?`),
    };
  }

  async grant(key, actorId) {
    this.#stmts.insertGrant.run(key, actorId, Date.now());
  }

  async grantMany(key, actorIds) {
    const tx = this.#db.transaction((k, actors) => {
      const at = Date.now();
      for (const actorId of actors) this.#stmts.insertGrant.run(k, actorId, at);
    });
    tx(key, actorIds ?? []);
  }

  async check(actorId, key) {
    return this.#stmts.selectGrant.get(key, actorId) !== undefined;
  }

  async revokeKey(key) {
    this.#stmts.deleteKey.run(key);
  }

  async close() {
    try { this.#db.close(); } catch { /* idempotent */ }
  }
}
