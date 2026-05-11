/**
 * WebIdCache — in-memory cache of a user's WebID-profile pointers + the
 * resolved heavy-state resources.  Optional heartbeat refresh keeps the
 * cache fresh against profile edits on another device.
 *
 * Typical lifecycle:
 *
 *   const cache = new WebIdCache({
 *     webid:        anneWebid,
 *     fetch:        anneAgent.oidc.getAuthenticatedFetch(),
 *     read:         pseudoPod.read.bind(pseudoPod),
 *     heartbeatMs:  60_000,
 *   });
 *
 *   await cache.refresh();          // populate
 *   cache.storageMapping;           // → resource value (or null)
 *   cache.pointers.storageMappingUri; // → the pointer URI
 *
 *   cache.start();                  // begin heartbeat
 *   // ... time passes; cache auto-refreshes ...
 *   cache.stop();                   // tear down
 *
 * Events:
 *   - 'refresh' → ({ pointers, resolved })  on every successful refresh.
 *   - 'error'   → (err)                     on heartbeat refresh failure.
 *
 * The cache is **append-only on resolution** within a single refresh —
 * if a pointer is removed between refreshes, the corresponding slot is
 * cleared.  Pointers that fail to resolve (read error) leave the
 * previous value in place; an 'error' is emitted.
 */

import { EventEmitter } from 'node:events';
import { discoverPointers } from './discoverPointers.js';
import { resolvePointers }  from './resolvePointers.js';

const DEFAULT_HEARTBEAT_MS = 60_000;

export class WebIdCache extends EventEmitter {
  #webid;
  #fetch;
  #read;
  #heartbeatMs;

  #pointers   = {};
  #resolved   = {};
  #raw        = null;
  #intervalId = null;
  #lastRefreshAt = null;

  /**
   * @param {object} opts
   * @param {string} opts.webid       — the user's WebID URI
   * @param {(input: string, init?: object) => Promise<Response>} opts.fetch
   *                                   — typically `agent.oidc.getAuthenticatedFetch()` or `globalThis.fetch`
   * @param {(uri: string) => Promise<*>} [opts.read]
   *                                   — pointer-resolution reader (pseudo-pod.read or equivalent).
   *                                     If absent, only `pointers` populates; `resolved` stays empty.
   * @param {number} [opts.heartbeatMs] — refresh cadence in ms; default 60_000.  `0` disables.
   */
  constructor({ webid, fetch, read, heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
    super();
    if (!webid || typeof webid !== 'string') {
      throw Object.assign(new Error('WebIdCache: `webid` is required'), { code: 'INVALID_ARGUMENT' });
    }
    if (typeof fetch !== 'function') {
      throw Object.assign(new Error('WebIdCache: `fetch` must be a function'), { code: 'INVALID_ARGUMENT' });
    }
    this.#webid       = webid;
    this.#fetch       = fetch;
    this.#read        = (typeof read === 'function') ? read : null;
    this.#heartbeatMs = Number.isFinite(heartbeatMs) && heartbeatMs >= 0 ? heartbeatMs : DEFAULT_HEARTBEAT_MS;
  }

  /* ── Getters ─────────────────────────────────────────────────────────── */

  get webid()           { return this.#webid; }
  get pointers()        { return this.#pointers; }
  get raw()             { return this.#raw; }
  get lastRefreshAt()   { return this.#lastRefreshAt; }

  get storageMapping()  { return this.#resolved.storageMapping ?? null; }
  get agentRegistry()   { return this.#resolved.agentRegistry  ?? null; }
  get auditLog()        { return this.#resolved.auditLog       ?? null; }

  /** Snapshot of the resolved-resource map. */
  get resolved()        { return { ...this.#resolved }; }

  /* ── Refresh ──────────────────────────────────────────────────────────── */

  /**
   * Fetch the WebID profile, parse pointers, optionally resolve them.
   * On success emits 'refresh' with the new state.  Throws on profile-
   * fetch failure (so heartbeat can catch + emit 'error').
   *
   * @returns {Promise<{ pointers: object, resolved: object }>}
   */
  async refresh() {
    const { pointers, raw } = await discoverPointers(this.#webid, { fetch: this.#fetch });
    this.#pointers = pointers;
    this.#raw      = raw;

    if (this.#read) {
      const onError = (err, key, uri) => this.emit('error', Object.assign(err, { resolveKey: key, resolveUri: uri }));
      const next = await resolvePointers(pointers, { read: this.#read, onError });
      // Clear keys whose pointer is no longer present, but keep keys
      // whose resolve failed (use the previous value).
      const newResolved = {};
      for (const [key, val] of Object.entries(next)) newResolved[key] = val;
      // For keys that are no longer pointed at, drop them.
      // For keys still pointed at but failed to resolve, keep previous value.
      for (const [key, prevVal] of Object.entries(this.#resolved)) {
        const stillPointed = !!pointers[`${key}Uri`];
        if (stillPointed && !(key in newResolved)) newResolved[key] = prevVal;
      }
      this.#resolved = newResolved;
    } else {
      // Without a reader, resolved stays empty; clear any prior state.
      this.#resolved = {};
    }

    this.#lastRefreshAt = Date.now();
    this.emit('refresh', { pointers: this.#pointers, resolved: this.#resolved });
    return { pointers: this.#pointers, resolved: this.#resolved };
  }

  /* ── Heartbeat ───────────────────────────────────────────────────────── */

  /** Begin periodic refresh.  Idempotent. */
  start() {
    if (this.#intervalId || this.#heartbeatMs === 0) return;
    this.#intervalId = setInterval(() => {
      this.refresh().catch(err => this.emit('error', err));
    }, this.#heartbeatMs);
    // Don't keep the Node process alive solely for the heartbeat.
    if (typeof this.#intervalId.unref === 'function') this.#intervalId.unref();
  }

  /** Stop periodic refresh.  Idempotent. */
  stop() {
    if (this.#intervalId) clearInterval(this.#intervalId);
    this.#intervalId = null;
  }

  /** Convenience: stop heartbeat + drop references. */
  close() { this.stop(); }
}
