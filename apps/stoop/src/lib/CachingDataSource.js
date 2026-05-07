/**
 * CachingDataSource — local-first DataSource that wraps an optional
 * remote / pod-backed DataSource with a Map cache + write queue.
 *
 * **Substrate candidate (rule of two — first consumer):** when a
 * second agentic app needs "boot offline, attach pod later, queue
 * writes, foreground-only poll" semantics, extract this + `SyncCadence`
 * into `@canopy/local-store` (or extend `@canopy/sync-engine`'s
 * shape to cover non-file data).  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 *
 * Rationale (Stoop V1 Phase 4 — 2026-05-06):
 *   - The pod is the source of truth, the local cache is reality
 *     (per the project-wide rule in
 *     `Project Files/projects/README.md`).
 *   - The app must boot and run without an authenticated pod (the
 *     "Local-only mode is the floor" rule). Sign-in attaches a pod
 *     mid-session; the queue flushes automatically.
 *   - Pod outages must not block the UI. Writes always succeed
 *     locally; failed remote sync queues for retry.
 *
 * Composition:
 *   - `new CachingDataSource()`                   → pure local (no inner; works offline forever)
 *   - `new CachingDataSource({ inner: pod })`     → local + write-through to pod
 *   - `cache.attachInner(pod)`                    → swap inner mid-flight; auto-flushes
 *
 * Read path:
 *   - Always check local first.
 *   - If miss + inner present + online → fetch from inner; populate local; return.
 *   - Otherwise return null.
 *
 * Write / delete path:
 *   - Always mutate local.
 *   - Enqueue for inner (if inner present).
 *   - If online → attempt flush (best-effort; failure flips online → false).
 *
 * List / query: local only. Fresh data from inner is pulled by
 * `pullFromInner(prefix)` on the app's chosen cadence (typically
 * tied to foreground state via `SyncCadence`).
 *
 * Events (Emitter): `online`, `offline`, `queued`, `flushed`, `pulled`, `error`.
 */

import { Emitter } from '@canopy/core';
import { DataSource } from '@canopy/core';

/** @typedef {{ op: 'write'|'delete', path: string, data?: any }} QueueEntry */

export class CachingDataSource extends DataSource {
  /** @type {Map<string, any>} */
  #local;
  /** @type {DataSource | null} */
  #inner;
  /** @type {QueueEntry[]} */
  #queue = [];
  /** @type {boolean} */
  #online;
  /** @type {Emitter} */
  #emitter = new Emitter();
  /** Optional persistence hook fired after every local mutation. */
  #onLocalChange = null;

  /**
   * @param {object} [opts]
   * @param {DataSource} [opts.inner]            optional inner DataSource (pod, etc.)
   * @param {Map<string, any>} [opts.localStore] optional local store (defaults to a fresh Map)
   * @param {boolean} [opts.online=true]         initial online state
   * @param {(map: Map<string, any>) => void} [opts.onLocalChange]
   *   Optional callback fired after every local-cache mutation
   *   (write / delete / pull).  Apps wire this to a `FilePersist`
   *   adapter to survive process restarts:
   *
   *     const persist = new FilePersist({ path });
   *     const cache = new CachingDataSource({
   *       inner, localStore: await persist.load(),
   *       onLocalChange: (m) => persist.scheduleSave(m),
   *     });
   */
  constructor({ inner = null, localStore, online = true, onLocalChange } = {}) {
    super();
    this.#inner          = inner;
    this.#local          = localStore ?? new Map();
    this.#online         = online;
    this.#onLocalChange  = typeof onLocalChange === 'function' ? onLocalChange : null;
  }

  /** Fire the persistence hook (best-effort). */
  #notifyLocalChange() {
    if (!this.#onLocalChange) return;
    try { this.#onLocalChange(this.#local); } catch { /* persistence is best-effort */ }
  }

  // ── Emitter passthrough ──────────────────────────────────────────────────

  on(name, handler)  { return this.#emitter.on(name, handler); }
  off(name, handler) { return this.#emitter.off?.(name, handler); }
  emit(name, payload) { return this.#emitter.emit(name, payload); }

  // ── State accessors ──────────────────────────────────────────────────────

  /** True when the cache has an inner DataSource AND it's reachable. */
  get isOnline() { return this.#online && this.#inner !== null; }

  /** True when an inner DataSource has been attached. */
  get hasInner() { return this.#inner !== null; }

  /** Number of pending queued ops (writes + deletes). */
  get queueLength() { return this.#queue.length; }

  /** Snapshot of the queue (read-only — do not mutate). */
  get queue() { return this.#queue.slice(); }

  // ── Lifecycle controls ───────────────────────────────────────────────────

  /**
   * Attach (or swap) the inner DataSource. If the new inner is non-null
   * and we're online, the queue flushes immediately.
   */
  async attachInner(inner) {
    this.#inner = inner ?? null;
    if (this.#inner && this.#online) {
      await this.flush();
    }
  }

  /**
   * Toggle online state. Going online → flush queue. Going offline →
   * subsequent writes still succeed locally; queue grows until next online.
   */
  async setOnline(value) {
    const wasOnline = this.#online;
    this.#online = !!value;
    if (this.#online && !wasOnline) {
      this.#emitter.emit('online', {});
      await this.flush();
    } else if (!this.#online && wasOnline) {
      this.#emitter.emit('offline', {});
    }
  }

  /**
   * Best-effort drain of the queue against the inner DataSource. Stops
   * on the first failure and flips online → false. Returns the number
   * of ops successfully replayed.
   */
  async flush() {
    if (!this.#inner) return 0;
    let replayed = 0;
    while (this.#queue.length > 0) {
      const entry = this.#queue[0];
      try {
        if (entry.op === 'write')   await this.#inner.write(entry.path, entry.data);
        if (entry.op === 'delete')  await this.#inner.delete(entry.path);
        this.#queue.shift();
        replayed += 1;
      } catch (err) {
        // Stay in queue; flip offline; emit error.
        this.#online = false;
        this.#emitter.emit('error',   { error: err, op: entry });
        this.#emitter.emit('offline', { reason: 'flush-failed' });
        return replayed;
      }
    }
    if (replayed > 0) this.#emitter.emit('flushed', { count: replayed });
    return replayed;
  }

  /**
   * Pull paths matching `prefix` from the inner DataSource into the
   * local cache, replacing local entries. Used by the app's sync
   * cadence to refresh from the pod on a poll. Returns the number of
   * paths pulled.
   *
   * Best-effort: failure flips online → false and re-throws so the
   * caller can decide whether to surface a banner.
   */
  async pullFromInner(prefix = '') {
    if (!this.#inner) return 0;
    if (!this.#online) return 0;
    let count = 0;
    try {
      const paths = await this.#inner.list(prefix);
      for (const p of paths) {
        const v = await this.#inner.read(p);
        if (v !== null) {
          this.#local.set(p, v);
          count += 1;
        }
      }
      if (count > 0) this.#notifyLocalChange();
      this.#emitter.emit('pulled', { prefix, count });
      return count;
    } catch (err) {
      this.#online = false;
      this.#emitter.emit('error',   { error: err, op: { op: 'pull', prefix } });
      this.#emitter.emit('offline', { reason: 'pull-failed' });
      throw err;
    }
  }

  // ── DataSource interface ─────────────────────────────────────────────────

  async read(path) {
    if (this.#local.has(path)) return this.#local.get(path);
    if (!this.#inner || !this.#online) return null;
    try {
      const v = await this.#inner.read(path);
      if (v !== null) {
        this.#local.set(path, v);
        this.#notifyLocalChange();
      }
      return v;
    } catch (err) {
      this.#online = false;
      this.#emitter.emit('error',   { error: err, op: { op: 'read', path } });
      this.#emitter.emit('offline', { reason: 'read-failed' });
      return null;
    }
  }

  async write(path, data) {
    this.#local.set(path, data);
    this.#notifyLocalChange();
    if (!this.#inner) return;
    this.#queue.push({ op: 'write', path, data });
    this.#emitter.emit('queued', { op: 'write', path, depth: this.#queue.length });
    if (this.#online) await this.flush();
  }

  async delete(path) {
    this.#local.delete(path);
    this.#notifyLocalChange();
    if (!this.#inner) return;
    this.#queue.push({ op: 'delete', path });
    this.#emitter.emit('queued', { op: 'delete', path, depth: this.#queue.length });
    if (this.#online) await this.flush();
  }

  async list(prefix = '') {
    const out = [];
    for (const key of this.#local.keys()) {
      if (key.startsWith(prefix)) out.push(key);
    }
    return out.sort();
  }

  async query(filter = {}) {
    // Mirrors MemorySource's query — the local cache is a Map of
    // path → JSON-encoded item.  Apps that want pod-side query must
    // call `pullFromInner` first; the cache is never authoritative
    // for "ask the pod for items I don't have".
    const results = [];
    for (const [path, value] of this.#local) {
      let parsed;
      try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) continue;
      if (_matches(parsed, filter)) results.push({ path, ...parsed });
    }
    return results;
  }

  /** Number of locally-cached entries (testing / diagnostics). */
  get localSize() { return this.#local.size; }
}

function _matches(obj, filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (obj[k] !== v) return false;
  }
  return true;
}
