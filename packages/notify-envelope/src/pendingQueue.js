/**
 * Pending-pod-upload queue.
 *
 * When a pod-having writer is offline, full-payload fan-out goes
 * out immediately (so peers stay current via the replication ring)
 * but the resource also lands in this queue. On reconnect, the
 * queue drains:
 *
 *   1. Each pending entry is uploaded to the writer's pod via the
 *      caller-supplied `uploadFn`.
 *   2. A fresh **envelope-only** message goes out to the same
 *      recipients so they promote their ring-cached entry to
 *      "pod-canonical."
 *   3. The queue entry is deleted.
 *
 * Persistence:
 *
 *   The queue lives on the pseudo-pod's *backend* (not via
 *   `pseudoPod.write`, which would fan out to peers in
 *   replication-ring mode). Keys: `__pending-pod-uploads__/<id>`.
 *   Survives process restart as long as the backend does.
 *
 * Standardisation Phase 52.4 — locked 2026-05-11. See plan §52.4.4.
 *
 * @typedef {object} QueueEntry
 * @property {string} id
 * @property {string} uri
 * @property {*}      payload
 * @property {string} [etag]
 * @property {string} type
 * @property {string[]} recipients
 * @property {string} [fromActor]
 * @property {string} [crewId]
 * @property {string} queuedAt   — ISO timestamp
 */

const QUEUE_PREFIX = '__pending-pod-uploads__/';

/**
 * @param {object} opts
 * @param {object} opts.backend       — StorageBackend (e.g. pseudoPod.backend)
 * @param {() => string} [opts.now]   — ISO timestamp generator (test injectable)
 * @param {() => string} [opts.makeId]
 */
export function createPendingQueue({
  backend,
  now    = () => new Date().toISOString(),
  makeId = () => Math.random().toString(36).slice(2, 10),
} = {}) {
  if (!backend || typeof backend.put !== 'function') {
    throw Object.assign(
      new Error('createPendingQueue: `backend` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

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
    if (typeof entry.type !== 'string' || entry.type.length === 0) {
      throw Object.assign(
        new Error('enqueue: entry.type is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const id = entry.id ?? makeId();
    const record = {
      id,
      uri:        entry.uri,
      payload:    entry.payload,
      ...(entry.etag       != null ? { etag:       entry.etag } : {}),
      type:       entry.type,
      recipients: Array.isArray(entry.recipients) ? [...entry.recipients] : [],
      ...(entry.fromActor  != null ? { fromActor:  entry.fromActor } : {}),
      ...(entry.crewId     != null ? { crewId:     entry.crewId } : {}),
      queuedAt:   entry.queuedAt ?? now(),
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
    // Older entries first — preserves write order across restarts.
    out.sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0));
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
   * Drain the queue: upload each pending entry via `uploadFn`,
   * re-emit an envelope-only message via `emitFn`, then delete the
   * entry. Stops on the first failure (preserving order) so the
   * next reconnect can retry from where we left off.
   *
   * @param {object} args
   * @param {(entry: QueueEntry) => Promise<void>} args.uploadFn
   * @param {(entry: QueueEntry) => Promise<void>} [args.emitFn]
   * @returns {Promise<{ drained: number, remaining: number, error?: Error }>}
   */
  async function drain({ uploadFn, emitFn } = {}) {
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
      try {
        await uploadFn(entry);
      } catch (err) {
        firstError = err;
        break;   // preserve order — next reconnect retries from here
      }
      if (typeof emitFn === 'function') {
        try { await emitFn(entry); } catch (_err) { /* best-effort */ }
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
