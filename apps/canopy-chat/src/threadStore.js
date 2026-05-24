/**
 * canopy-chat — ThreadStore (multi-thread workspace).
 *
 * v0.2 graduates the single-thread `Thread` to a workspace of N
 * threads.  Per design choice D in `DESIGN-canopy-chat-journeys.md`:
 *
 *   - Threads are USER-MANAGED instances, not auto-created by app
 *     or person taxonomy.
 *   - Each thread has its own filter + permissions + state.
 *   - One thread is "active" at a time (UI-level concept; events
 *     route to ALL matching threads regardless of active).
 *
 * v0.2 ships in-memory ThreadStore.  v0.2.4 (deferred sub-slice 2.8)
 * adds IndexedDB persistence; v0.6 adds pod-sync per OQ-3 user
 * resolution.
 *
 * Phase v0.2 sub-slice 2.1 per `/Project Files/canopy-chat/coding-plan.md`.
 */

import { Thread }            from './thread.js';
import { normaliseFilter }   from './filter.js';

let _idSeq = 0;
function nextThreadId() {
  _idSeq += 1;
  return `t-${Date.now().toString(36)}-${_idSeq.toString(36)}`;
}

/**
 * Reset the thread-id counter — test seam.
 * @internal
 */
export function __resetThreadIdSeq() { _idSeq = 0; }

export class ThreadStore {
  /** @type {Map<string, Thread>} */
  #threads;
  /** @type {string|null} */
  #activeId;
  /** @type {Array<(event: object) => void>} */
  #subscribers;
  /** @type {() => number} */
  #now;

  /**
   * @param {object}       [opts]
   * @param {() => number} [opts.now=Date.now]   injectable clock for tests
   */
  constructor(opts = {}) {
    this.#threads     = new Map();
    this.#activeId    = null;
    this.#subscribers = [];
    this.#now         = typeof opts.now === 'function' ? opts.now : Date.now;
  }

  /* ─── thread lifecycle ─────────────────────────────────── */

  /**
   * Create a new thread.  Returns the live Thread instance.
   *
   * @param {object}                                [opts]
   * @param {string}                                [opts.id]      auto-generated when absent
   * @param {string}                                [opts.name]    required for user-visible threads
   * @param {import('./filter.js').ThreadFilter}    [opts.filter]
   * @param {object}                                [opts.permissions]
   * @returns {Thread}
   */
  createThread(opts = {}) {
    const id = opts.id ?? nextThreadId();
    if (this.#threads.has(id)) {
      throw new Error(`ThreadStore.createThread: id "${id}" already exists`);
    }
    const thread = new Thread({
      id,
      name:        opts.name ?? id,
      createdAt:   this.#now(),
      filter:      normaliseFilter(opts.filter),
      permissions: opts.permissions,
      origin:      opts.origin,    // #181 — back-to-origin metadata
      now:         this.#now,
      // v0.7.P1 bug-fix — wire the thread's onChange callback so
      // every message append (add{User,Shell}Message) bubbles up
      // as a thread-updated event.  attachPersistence subscribes
      // to thread-updated → so messages now persist across refresh.
      onChange:    () => this.#emit({ kind: 'thread-updated', threadId: id }),
    });
    this.#threads.set(id, thread);
    if (this.#activeId === null) this.#activeId = id;
    this.#emit({ kind: 'thread-created', threadId: id });
    return thread;
  }

  /**
   * Look up a thread by id.
   *
   * @param {string} id
   * @returns {Thread | undefined}
   */
  getThread(id) {
    return this.#threads.get(id);
  }

  /**
   * Delete a thread.  Active id reassigned to the remaining thread
   * with the most-recent createdAt, or null if no threads remain.
   *
   * @param {string} id
   * @returns {boolean}   true if deleted, false if no such thread
   */
  deleteThread(id) {
    const had = this.#threads.delete(id);
    if (!had) return false;
    if (this.#activeId === id) {
      // Pick the newest remaining thread as the new active.
      const remaining = [...this.#threads.values()]
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      this.#activeId = remaining[0]?.id ?? null;
    }
    this.#emit({ kind: 'thread-deleted', threadId: id });
    return true;
  }

  /**
   * Update a thread's filter / permissions / name.  Returns the
   * updated Thread, or undefined when not found.
   *
   * @param {string} id
   * @param {{name?: string,
   *          filter?: import('./filter.js').ThreadFilter,
   *          permissions?: object}} patch
   * @returns {Thread | undefined}
   */
  updateThread(id, patch) {
    const t = this.#threads.get(id);
    if (!t) return undefined;
    if (patch.name !== undefined)        t.name = String(patch.name);
    if (patch.filter !== undefined)      t.filter = normaliseFilter(patch.filter);
    if (patch.permissions !== undefined) {
      t.permissions = {
        allowCommands: patch.permissions.allowCommands ?? t.permissions.allowCommands,
        ...(patch.permissions.allowedApps !== undefined
          ? { allowedApps: patch.permissions.allowedApps }
          : t.permissions.allowedApps !== undefined
            ? { allowedApps: t.permissions.allowedApps }
            : {}),
      };
    }
    this.#emit({ kind: 'thread-updated', threadId: id });
    return t;
  }

  /**
   * List all threads, sorted by createdAt (newest first).
   *
   * @returns {Thread[]}
   */
  listThreads() {
    return [...this.#threads.values()]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  /** Number of threads. */
  get size() { return this.#threads.size; }

  /* ─── active thread ───────────────────────────────────── */

  /**
   * The currently-active thread id (UI focus).  Returns null when
   * no thread exists.
   */
  get activeId() { return this.#activeId; }

  /** The currently-active Thread, or undefined when none. */
  getActiveThread() {
    if (!this.#activeId) return undefined;
    return this.#threads.get(this.#activeId);
  }

  /**
   * Set the active thread by id.  Throws if the id doesn't exist.
   *
   * @param {string} id
   */
  setActiveThread(id) {
    if (!this.#threads.has(id)) {
      throw new Error(`ThreadStore.setActiveThread: no thread "${id}"`);
    }
    this.#activeId = id;
    this.#emit({ kind: 'active-changed', threadId: id });
  }

  /* ─── event subscription (for the renderer / event router) ─ */

  /**
   * Subscribe to store-level events: thread-created, thread-deleted,
   * thread-updated, active-changed.  Returns an unsubscribe function.
   *
   * @param {(event: {kind: string, threadId?: string}) => void} fn
   * @returns {() => void}
   */
  subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('subscribe: fn required');
    this.#subscribers.push(fn);
    return () => {
      this.#subscribers = this.#subscribers.filter((s) => s !== fn);
    };
  }

  #emit(event) {
    for (const fn of this.#subscribers) {
      try { fn(event); } catch { /* swallow subscriber errors */ }
    }
  }
}

/**
 * Convenience: a fresh ThreadStore with the default Main + Inbox
 * threads seeded.  Per the coding plan v0.2's "default threads on
 * fresh install" (sub-slice 2.4 — partial impl here; UI lands in
 * v0.2.3).
 *
 *   Main  — commands enabled, no events (focus thread)
 *   Inbox — events only (notifications + reminders), commands also
 *           enabled so the user can [Thank] / [Claim] from a card
 *
 * @param {object} [opts]
 * @returns {ThreadStore}
 */
export function createDefaultThreadStore(opts) {
  const store = new ThreadStore(opts);
  store.createThread({
    id:     'main',
    name:   'Main',
    // v0.7.P1 bug-fix 2026-05-23: filter `{}` ACTUALLY matches every
    // event (matchesKey treats absent allowed-lists as wildcard).
    // The old comment claimed it received 'no auto-events', which
    // was wrong — every routed event landed here, doubling
    // confirmation messages (the dispatched reply AND the routed
    // event).  `{ not: {} }` semantically = NOT (anything) = nothing,
    // so Main becomes a typed-input-only thread.  Notifications +
    // events route to Inbox / custom alert threads.
    filter: { not: {} },
    permissions: { allowCommands: true },
  });
  store.createThread({
    id:     'inbox',
    name:   'Inbox',
    filter: { eventTypes: ['notification', 'reminder'] },
    permissions: { allowCommands: true },
  });
  // Main starts active (it was created first).
  store.setActiveThread('main');
  return store;
}
