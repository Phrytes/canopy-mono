/**
 * IngestQueueSource — H6/H7 use case.  External code (a connector
 * agent) pushes items to the queue; SyncEngine drains them and
 * applies to the backend.
 *
 * Source interface required by SyncEngine:
 *   start()            — begin processing
 *   stop()             — halt
 *   onItem(handler)    — register the per-item callback
 *   drain()            — pull all pending items right now (optional)
 */

export class IngestQueueSource {
  /** @type {Array<object>} */
  #queue = [];
  /** @type {((item: object) => Promise<void>)|null} */
  #handler = null;
  /** @type {boolean} */
  #started = false;

  async start() {
    this.#started = true;
    // Flush anything that was enqueued before start().
    await this.#flush();
  }

  async stop() {
    this.#started = false;
  }

  onItem(handler) {
    this.#handler = handler;
  }

  /**
   * Connector agents call this to inject items.
   *
   * @param {object} item
   *   {relPath?, targetUri?, content?, size?, referenceUri?, hash?, contentType?, metadata?, lastModified?}
   */
  async ingest(item) {
    this.#queue.push({ ...item });
    if (this.#started) await this.#flush();
  }

  /**
   * Bulk-ingest helper.
   */
  async ingestMany(items) {
    for (const it of items) this.#queue.push({ ...it });
    if (this.#started) await this.#flush();
  }

  /**
   * Pull all pending items as a snapshot (used by SyncEngine.syncOnce).
   *
   * @returns {Promise<object[]>}
   */
  async drain() {
    const items = [...this.#queue];
    this.#queue.length = 0;
    return items;
  }

  /**
   * Pending count — useful for progress reporting.
   */
  get pending() { return this.#queue.length; }

  async #flush() {
    if (!this.#handler) return;
    while (this.#queue.length > 0) {
      const item = this.#queue.shift();
      await this.#handler(item);
    }
  }
}
