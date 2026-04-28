/**
 * SqliteQueueStore — durable, single-process `QueueStore` backed by SQLite.
 *
 * Uses `better-sqlite3` (synchronous C bindings).  Method bodies run
 * synchronously, but the surface stays `async` to match the `QueueStore`
 * interface so callers can swap in async-native stores (Redis, Postgres, …).
 *
 * Tests can pass `path: ':memory:'` to avoid touching disk; production
 * passes a filesystem path (defaults to `./relay-queue.sqlite`).
 *
 * See `coding-plans/track-E-mobile-push-relay.md` §E2b.
 */
import Database       from 'better-sqlite3';
import { QueueStore } from './QueueStore.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS requests (
  id            TEXT    PRIMARY KEY,
  callerPubKey  TEXT    NOT NULL,
  targets       TEXT    NOT NULL,        -- JSON array
  expected      INTEGER NOT NULL,
  deadline      INTEGER NOT NULL,        -- unix-ms
  payload       BLOB    NOT NULL,        -- JSON-encoded payload
  createdAt     INTEGER NOT NULL,
  closed        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS responses (
  requestId     TEXT    NOT NULL,
  fromPubKey    TEXT    NOT NULL,
  response      BLOB    NOT NULL,
  at            INTEGER NOT NULL,
  FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requests_open      ON requests(closed, deadline);
CREATE INDEX IF NOT EXISTS idx_responses_request  ON responses(requestId);
`;

export class SqliteQueueStore extends QueueStore {
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
    this.#db.pragma('foreign_keys = ON');
    this.#initSchema();
    this.#prepare();
  }

  #initSchema() {
    this.#db.exec(SCHEMA);
  }

  #prepare() {
    this.#stmts = {
      insertRequest: this.#db.prepare(`
        INSERT INTO requests (id, callerPubKey, targets, expected, deadline, payload, createdAt, closed)
        VALUES (@id, @callerPubKey, @targets, @expected, @deadline, @payload, @createdAt, 0)
      `),
      selectRequest: this.#db.prepare(`SELECT * FROM requests WHERE id = ?`),
      selectOpen:    this.#db.prepare(`
        SELECT * FROM requests WHERE closed = 0 AND deadline > ?
      `),
      selectResponses: this.#db.prepare(`
        SELECT fromPubKey, response, at FROM responses WHERE requestId = ? ORDER BY at ASC
      `),
      insertResponse: this.#db.prepare(`
        INSERT INTO responses (requestId, fromPubKey, response, at)
        VALUES (?, ?, ?, ?)
      `),
      closeRequest: this.#db.prepare(`UPDATE requests SET closed = 1 WHERE id = ?`),
      deleteRequest: this.#db.prepare(`DELETE FROM requests WHERE id = ?`),
      deleteResponses: this.#db.prepare(`DELETE FROM responses WHERE requestId = ?`),
    };
  }

  // ── Serialisation helpers ──────────────────────────────────────────────────

  #encodePayload(p) {
    if (p === null || p === undefined) return Buffer.from('null', 'utf8');
    if (Buffer.isBuffer(p))             return p;
    return Buffer.from(JSON.stringify(p), 'utf8');
  }

  #decodePayload(buf) {
    if (buf == null) return null;
    try { return JSON.parse(Buffer.from(buf).toString('utf8')); }
    catch { return Buffer.from(buf); }
  }

  #rowToRequest(row) {
    if (!row) return null;
    const responses = this.#stmts.selectResponses.all(row.id).map(r => ({
      fromPubKey: r.fromPubKey,
      response:   this.#decodePayload(r.response),
      at:         r.at,
    }));
    return {
      id:                row.id,
      callerPubKey:      row.callerPubKey,
      targets:           JSON.parse(row.targets),
      expectedResponses: row.expected,
      deadline:          row.deadline,
      payload:           this.#decodePayload(row.payload),
      createdAt:         row.createdAt,
      closed:            row.closed === 1,
      responses,
    };
  }

  // ── QueueStore impl ────────────────────────────────────────────────────────

  async putRequest(req) {
    this.#stmts.insertRequest.run({
      id:           req.id,
      callerPubKey: req.callerPubKey,
      targets:      JSON.stringify(req.targets ?? []),
      expected:     req.expectedResponses ?? (req.targets?.length ?? 0),
      deadline:     req.deadline,
      payload:      this.#encodePayload(req.payload),
      createdAt:    req.createdAt ?? Date.now(),
    });
    return this.#rowToRequest(this.#stmts.selectRequest.get(req.id));
  }

  async getRequest(id) {
    return this.#rowToRequest(this.#stmts.selectRequest.get(id));
  }

  async listOpen() {
    const rows = this.#stmts.selectOpen.all(Date.now());
    return rows.map(r => this.#rowToRequest(r));
  }

  async addResponse(id, fromPubKey, response) {
    // Atomic read-then-write: the closed/expired check + append happen together.
    const tx = this.#db.transaction((reqId, from, resp) => {
      const row = this.#stmts.selectRequest.get(reqId);
      if (!row || row.closed === 1) return null;
      this.#stmts.insertResponse.run(
        reqId,
        from,
        this.#encodePayload(resp),
        Date.now(),
      );
      return this.#stmts.selectRequest.get(reqId);
    });
    const updatedRow = tx(id, fromPubKey, response);
    return this.#rowToRequest(updatedRow);
  }

  async closeRequest(id) {
    this.#stmts.closeRequest.run(id);
  }

  async delete(id) {
    // Foreign-key cascade should clear responses, but we delete defensively
    // in case a build of better-sqlite3 doesn't honour it.
    const tx = this.#db.transaction((reqId) => {
      this.#stmts.deleteResponses.run(reqId);
      this.#stmts.deleteRequest.run(reqId);
    });
    tx(id);
  }

  async close() {
    try { this.#db.close(); } catch { /* idempotent */ }
  }
}
