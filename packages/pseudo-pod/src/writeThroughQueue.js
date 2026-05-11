/**
 * Write-through queue — cache-mode V1.
 *
 * When the pseudo-pod is in `cache` mode (or has a per-URI override
 * set to `cache`), every local write is also enqueued here for
 * write-through to the real pod via the caller-supplied
 * `podUploader`. On reconnect (signalled via
 * `pseudoPod.drainWriteThroughQueue()`), entries are drained in
 * insertion order.
 *
 * Persistence:
 *   The queue lives directly on the backend under the
 *   `__write-through__/` prefix (bypassing pseudoPod.write so the
 *   queue itself doesn't fan out to peers in replication-ring mode).
 *   Survives process restart as long as the backend does.
 *
 * Drain semantics:
 *   On upload failure (network, transient pod error), the drain
 *   stops on that entry — the next reconnect retries from there.
 *   412 (conflict) handling is V0-deferred: the substrate logs the
 *   conflict and stops; caller-side conflict resolution is left as
 *   a future hook (52.8 open question).
 *
 * Standardisation Phase 52.8.3.
 *
 * @typedef {object} WriteThroughEntry
 * @property {string} id
 * @property {string} uri
 * @property {*}      bytes
 * @property {string} [etag]            — etag of the local write
 * @property {string} queuedAt
 */

const QUEUE_PREFIX = '__write-through__/';

/**
 * @param {object} opts
 * @param {object} opts.backend
 * @param {() => string} [opts.now]
 * @param {() => string} [opts.makeId]
 */
export function createWriteThroughQueue({
  backend,
  now    = () => new Date().toISOString(),
  makeId = () => Math.random().toString(36).slice(2, 10),
} = {}) {
  if (!backend || typeof backend.put !== 'function') {
    throw Object.assign(
      new Error('createWriteThroughQueue: `backend` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  // Monotonic per-instance sequence — tie-breaker when two writes land
  // in the same millisecond. Sequence persistence across substrate
  // restarts is unnecessary: on restart the queue resorts by
  // (queuedAt, seq); the next session's seq starts at 0 again but the
  // queuedAt strings still order older entries before newer ones.
  let seqCounter = 0;

  async function enqueue(entry) {
    if (!entry || typeof entry !== 'object') {
      throw Object.assign(
        new Error('enqueue: entry must be an object'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof entry.uri !== 'string' || entry.uri.length === 0) {
      throw Object.assign(
        new Error('enqueue: entry.uri is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const id = entry.id ?? makeId();
    const record = {
      id,
      uri:        entry.uri,
      bytes:      entry.bytes,
      ...(entry.etag != null ? { etag: entry.etag } : {}),
      queuedAt:   entry.queuedAt ?? now(),
      seq:        entry.seq ?? ++seqCounter,
    };
    await backend.put(QUEUE_PREFIX + id, record);
    return record;
  }

  async function list() {
    const keys = await backend.list(QUEUE_PREFIX);
    const out = [];
    for (const k of keys) {
      const rec = await backend.get(k);
      if (rec?.bytes) out.push(rec.bytes);
    }
    // (queuedAt, seq) lexicographic order — seq disambiguates same-ms entries.
    out.sort((a, b) => {
      if (a.queuedAt < b.queuedAt) return -1;
      if (a.queuedAt > b.queuedAt) return 1;
      const sa = typeof a.seq === 'number' ? a.seq : 0;
      const sb = typeof b.seq === 'number' ? b.seq : 0;
      return sa - sb;
    });
    return out;
  }

  async function remove(id) {
    if (typeof id !== 'string' || id.length === 0) return;
    await backend.delete(QUEUE_PREFIX + id);
  }

  async function size() {
    return (await backend.list(QUEUE_PREFIX)).length;
  }

  async function clear() {
    const keys = await backend.list(QUEUE_PREFIX);
    for (const k of keys) await backend.delete(k);
  }

  /**
   * Drain: call `uploadFn(entry)` for each pending entry in order;
   * delete on success; stop on the first failure and report
   * remaining count.
   *
   * @param {object} args
   * @param {(entry: WriteThroughEntry) => Promise<{etag?: string} | void>} args.uploadFn
   * @param {(entry: WriteThroughEntry, result: {etag?: string} | void) => Promise<void>} [args.onSuccess]
   * @returns {Promise<{drained: number, remaining: number, error?: Error}>}
   */
  async function drain({ uploadFn, onSuccess } = {}) {
    if (typeof uploadFn !== 'function') {
      throw Object.assign(
        new Error('drain: uploadFn is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const entries = await list();
    let drained = 0;
    let firstError = null;
    for (const entry of entries) {
      let result;
      try {
        result = await uploadFn(entry);
      } catch (err) {
        firstError = err;
        break;   // preserve order
      }
      if (typeof onSuccess === 'function') {
        try { await onSuccess(entry, result); } catch (_err) { /* best-effort */ }
      }
      await remove(entry.id);
      drained++;
    }
    return {
      drained,
      remaining: entries.length - drained,
      ...(firstError ? { error: firstError } : {}),
    };
  }

  return {
    enqueue,
    list,
    remove,
    drain,
    size,
    clear,
    QUEUE_PREFIX,
  };
}

export { QUEUE_PREFIX };
