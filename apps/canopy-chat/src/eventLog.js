/**
 * canopy-chat — network-events log (D.1, v0.7.1).
 *
 * Append-only chronological feed of every event that flowed through
 * the chat shell's EventRouter — INCLUDING events that no thread's
 * filter matched.  The chat shows you what's relevant to THIS
 * conversation; the log page shows the firehose so you can find
 * "what happened in my household yesterday?".
 *
 * Retention: 14 days (per OQ-7.B user resolution 2026-05-22).
 * Older events get pruned on every append + on explicit `prune()`.
 *
 * Storage: events persist via IndexedDB in a new `events` object
 * store keyed by `id` with an index on `ts` for fast prune-by-age.
 * The substrate stays platform-neutral; the caller (web/main.js)
 * supplies the `idb` helper.
 *
 * Platform: neutral.
 *
 * Phase v0.7 sub-slice 7.5 per `/Project Files/canopy-chat/coding-plan.md`.
 */

import { matchesFilter } from './filter.js';

/** 14 days in ms — OQ-7.B retention default. */
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * @typedef {object} LoggedEvent
 * @property {string} id
 * @property {number} ts
 * @property {string} app
 * @property {string} type
 * @property {string} [actor]
 * @property {{app: string, type: string, id: string}} [itemRef]
 * @property {*}      [payload]
 * @property {string} [correlationId]
 */

export class EventLog {
  /** @type {LoggedEvent[]} most-recent first */
  #events;
  /** @type {(events: LoggedEvent[]) => Promise<void>} */
  #persist;
  /** @type {() => number} */
  #now;
  /** @type {number} */
  #retentionMs;
  /** @type {Set<(event: LoggedEvent) => void>} */
  #subscribers;
  /** @type {Set<string>} */
  #mutedKeys;

  /**
   * @param {object}                          [opts]
   * @param {LoggedEvent[]}                   [opts.initial=[]]
   * @param {(events: LoggedEvent[]) => Promise<void>} [opts.persist]
   * @param {() => number}                    [opts.now=Date.now]
   * @param {number}                          [opts.retentionMs=RETENTION_MS]
   * @param {string[]}                        [opts.muted=[]]
   *   `<app>:<type>`-keyed entries.  Events matching a muted key
   *   are STILL logged (audit trail) but `query({excludeMuted: true})`
   *   filters them out.
   */
  constructor(opts = {}) {
    this.#events = Array.isArray(opts.initial) ? [...opts.initial] : [];
    this.#persist = typeof opts.persist === 'function' ? opts.persist : async () => {};
    this.#now = typeof opts.now === 'function' ? opts.now : Date.now;
    this.#retentionMs = typeof opts.retentionMs === 'number'
      ? opts.retentionMs : RETENTION_MS;
    this.#subscribers = new Set();
    this.#mutedKeys = new Set(Array.isArray(opts.muted) ? opts.muted : []);
  }

  /**
   * Append an event.  Idempotent on `id`: re-appends with the same
   * id overwrite the existing entry (covers EventRouter re-deliveries
   * during in-flight wake).  Prunes on every append.
   *
   * @param {LoggedEvent} event
   */
  append(event) {
    if (!event || typeof event !== 'object') return;
    if (typeof event.id !== 'string' || event.id === '') return;
    // De-dup on id.
    const existing = this.#events.findIndex((e) => e.id === event.id);
    if (existing !== -1) this.#events.splice(existing, 1);
    // Most-recent first.
    this.#events.unshift({ ...event });
    this.prune();
    // Persist async — caller doesn't await.
    this.#persist(this.#events.slice()).catch(() => {});
    for (const fn of this.#subscribers) {
      try { fn(event); } catch { /* swallow */ }
    }
  }

  /**
   * Prune events older than retentionMs.  Returns the number pruned.
   *
   * @returns {number}
   */
  prune() {
    const cutoff = this.#now() - this.#retentionMs;
    const before = this.#events.length;
    this.#events = this.#events.filter((e) => e.ts >= cutoff);
    return before - this.#events.length;
  }

  /**
   * Query the log.  Returns most-recent-first slice.
   *
   * @param {object}              [opts]
   * @param {import('./filter.js').ThreadFilter} [opts.filter]
   *   Same DSL as thread filters — flat key:value AND/OR-of-keys OR
   *   expression-tree form (OQ-2.A).
   * @param {number}              [opts.since]    only events with ts >= since
   * @param {number}              [opts.until]    only events with ts <= until
   * @param {boolean}             [opts.excludeMuted=false]
   * @param {number}              [opts.limit]
   * @returns {LoggedEvent[]}
   */
  query(opts = {}) {
    let result = this.#events;
    if (opts.filter) result = result.filter((e) => matchesFilter(e, opts.filter));
    if (typeof opts.since === 'number') result = result.filter((e) => e.ts >= opts.since);
    if (typeof opts.until === 'number') result = result.filter((e) => e.ts <= opts.until);
    if (opts.excludeMuted) {
      result = result.filter((e) => !this.#mutedKeys.has(`${e.app}:${e.type}`));
    }
    if (typeof opts.limit === 'number') result = result.slice(0, opts.limit);
    return result.slice();   // defensive copy
  }

  /** Total events currently in the log (post-prune). */
  get size() { return this.#events.length; }

  /**
   * Subscribe to new appended events.
   *
   * @param {(event: LoggedEvent) => void} fn
   * @returns {() => void}                 unsubscribe
   */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  /* ─── mute set (per-event-kind) ────────────────────────── */

  /** Mute key: `<app>:<type>`. */
  mute(app, type) {
    const key = `${app}:${type}`;
    if (this.#mutedKeys.has(key)) return false;
    this.#mutedKeys.add(key);
    this.#persistMuted(this.mutedList());
    return true;
  }

  unmute(app, type) {
    const key = `${app}:${type}`;
    if (!this.#mutedKeys.has(key)) return false;
    this.#mutedKeys.delete(key);
    this.#persistMuted(this.mutedList());
    return true;
  }

  isMuted(app, type) { return this.#mutedKeys.has(`${app}:${type}`); }

  /** Snapshot of muted keys (for serialisation). */
  mutedList() { return [...this.#mutedKeys].sort(); }

  /**
   * Set a persistor for the muted list.  Optional — main.js wires
   * this to the same IDB store the events live in.
   *
   * @param {(muted: string[]) => Promise<void>} fn
   */
  setMutedPersistor(fn) {
    if (typeof fn !== 'function') return;
    this.#persistMuted = fn.bind(null);
  }

  #persistMuted = async () => {};

  /* ─── connect to EventRouter ───────────────────────────── */

  /**
   * Wire this log to an EventRouter so every delivered event is
   * appended automatically.  Returns the unsubscribe handle.
   *
   * @param {import('./events.js').EventRouter} router
   * @returns {() => void}
   */
  attachToRouter(router) {
    if (!router || typeof router.onRouted !== 'function') {
      throw new TypeError('attachToRouter: router with onRouted required');
    }
    return router.onRouted((event /* , threadIds */) => {
      // Persist the FULL event regardless of whether any thread
      // matched.  The log is the audit trail; threads are the
      // foreground filter.
      this.append(event);
    });
  }
}

/**
 * Convenience factory.  Same API as `new EventLog(opts)`.
 *
 * @param {ConstructorParameters<typeof EventLog>[0]} opts
 * @returns {EventLog}
 */
export function createEventLog(opts) {
  return new EventLog(opts);
}
