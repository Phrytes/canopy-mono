/**
 * MockConnector — deterministic connector for tests + non-credentialed
 * scenarios.  Yields a static list of items (or items derived from
 * a function).  No OAuth, no HTTP — just synthetic data.
 */

export class MockConnector {
  /** @type {string} */ id;
  /** @type {Array<object>|((args: object) => Array<object>|AsyncIterable<object>)} */ #items;

  /**
   * @param {object} args
   * @param {string} [args.id='mock']
   * @param {Array<object> | (importArgs) => Array | AsyncIterable} args.items
   */
  constructor({ id = 'mock', items }) {
    if (!items) throw new TypeError('MockConnector: items required');
    this.id    = id;
    this.#items = items;
  }

  async *import(args) {
    const resolved = typeof this.#items === 'function' ? this.#items(args) : this.#items;
    if (Array.isArray(resolved)) {
      for (const it of resolved) yield it;
      return;
    }
    if (resolved && typeof resolved[Symbol.asyncIterator] === 'function') {
      for await (const it of resolved) yield it;
      return;
    }
    throw new TypeError('MockConnector: items must be an array or async iterable');
  }
}
