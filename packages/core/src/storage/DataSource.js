/**
 * DataSource — abstract base class for storage backends.
 *
 * All paths are forward-slash strings (e.g. 'notes/hello.txt').
 * Implementations must treat paths as opaque keys; no filesystem
 * traversal outside the configured root is required or enforced here.
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
