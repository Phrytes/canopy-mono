/**
 * ┌─ PORT ──────────────────────────────────────────────────────────────────────┐
 * │ `DataSource` is the interface a third-party storage adapter implements to     │
 * │ stay compatible with the @onderling SDK. "Compatible" = *satisfies this port*:    │
 * │ extend this base class and implement the CRUD-over-paths contract below.      │
 * │ Reference adapters: `MemorySource` / `IndexedDBSource` / `FileSystemSource`     │
 * │ (in @onderling/core) and `SolidPodSource` (in @onderling/pod-client). Prove          │
 * │ conformance with `assertDataSourceConformance()`                              │
 * │ (test/conformance/dataSourceConformance.js).                                  │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * DataSource — abstract base class for storage backends.
 *
 * All paths are forward-slash strings (e.g. 'notes/hello.txt').
 * Implementations must treat paths as opaque keys; no filesystem
 * traversal outside the configured root is required or enforced here.
 *
 * ── The port contract (what an adapter must uphold) ────────────────────────────
 *   • `read(path)`    → the stored value, or `null` when the path is absent.
 *   • `write(path, data)` → create-or-overwrite; resolves when durable.
 *   • `delete(path)`  → remove the path; a NO-OP (never throws) when absent.
 *   • `list(prefix='')` → every stored path that starts with `prefix`.
 *   • `query(filter={})` → OPTIONAL structured query. Adapters that can't support
 *                          it may leave the base throw in place; callers must treat
 *                          `query` as best-effort and tolerate its absence.
 * Every method is async (returns a Promise). Paths are opaque forward-slash keys.
 */
export class DataSource {
  /**
   * Read a value at path.
   * @param {string} path
   * @returns {Promise<Buffer|string|null>} null if not found
   */
  async read(path) { throw new Error(`${this.constructor.name}.read() not implemented`); }   // eslint-disable-line no-unused-vars

  /**
   * Write a value at path (creates or overwrites).
   * @param {string} path
   * @param {Buffer|string|Uint8Array} data
   * @returns {Promise<void>}
   */
  async write(path, data) { throw new Error(`${this.constructor.name}.write() not implemented`); }   // eslint-disable-line no-unused-vars

  /**
   * Delete a path. No-op if not found.
   * @param {string} path
   * @returns {Promise<void>}
   */
  async delete(path) { throw new Error(`${this.constructor.name}.delete() not implemented`); }   // eslint-disable-line no-unused-vars

  /**
   * List all paths that start with prefix.
   * @param {string} [prefix='']
   * @returns {Promise<string[]>}
   */
  async list(prefix = '') { throw new Error(`${this.constructor.name}.list() not implemented`); }   // eslint-disable-line no-unused-vars

  /**
   * Optional structured query. Not all backends support this.
   * @param {object} [filter={}]
   * @returns {Promise<object[]>}
   */
  async query(filter = {}) { throw new Error(`${this.constructor.name}.query() not implemented`); }   // eslint-disable-line no-unused-vars
}
