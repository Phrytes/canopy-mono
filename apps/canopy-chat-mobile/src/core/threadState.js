/**
 * Mobile-local thread state for #253 step 5.
 *
 * Pure reducer + helpers around a small Map<threadId, ThreadEntry>
 * + an active-thread id.  Used by ChatScreen to support multi-thread
 * + drawer-switching without pulling in the full portable ThreadStore
 * (which adds subscriber wiring + Thread-class lifecycle metadata
 * we don't need for the mobile V1).
 *
 * Future graduation path: when DM-spawning (#253 step 7) lands, we
 * can swap this for the canonical `@canopy-app/canopy-chat`
 * ThreadStore — both share the Map<id, entry> + activeId shape, so
 * ChatScreen consumers stay the same.
 *
 * Each thread entry carries:
 *   - id              stable, unique string
 *   - name            user-visible label
 *   - createdAt       epoch ms
 *   - messages        [] of {id, role, text|rendered, pending}
 *   - sourceDispatch  list-bubble origin dispatch for state morphing
 *                     (only one tracked per thread — the most recent
 *                     list dispatch).  See refreshList.js.
 *   - pendingFollowUp single-field follow-up shape (#253 step 4),
 *                     scoped to a thread so switching away parks the
 *                     pending question without losing it.
 *
 * The reducer is shape-pure: every mutator returns a new state
 * object so React's useState identity check fires re-renders.
 * Threads Map identity is preserved when nothing changed in it.
 */

const DEFAULT_THREAD_ID = 'main';

let _threadIdSeq = 0;
function nextThreadId() {
  _threadIdSeq += 1;
  return `t-${Date.now().toString(36)}-${_threadIdSeq.toString(36)}`;
}

/** Test seam — reset the id counter for deterministic snapshots. */
export function __resetThreadIdSeq() { _threadIdSeq = 0; }

/**
 * @typedef {object} ThreadEntry
 * @property {string}                id
 * @property {string}                name
 * @property {number}                createdAt
 * @property {Array<object>}         messages
 * @property {object|null}           sourceDispatch   most-recent list dispatch
 * @property {string|null}           [peerAddr]       Bundle H (#268): NKN address of the paired peer when this is a DM thread; undefined/null for regular threads
 */

/**
 * @typedef {object} ThreadState
 * @property {Map<string, ThreadEntry>}  threads
 * @property {string}                    activeThreadId
 */

/** Seed initial state with a single 'Main' thread. */
export function createInitialThreadState({ now = Date.now } = {}) {
  const main = {
    id:               DEFAULT_THREAD_ID,
    name:             'Main',
    createdAt:        now(),
    messages:         [],
    sourceDispatch:   null,
    pendingFollowUp:  null,
    peerAddr:         null,
  };
  return {
    threads:        new Map([[DEFAULT_THREAD_ID, main]]),
    activeThreadId: DEFAULT_THREAD_ID,
  };
}

/** Lookup helper. */
export function getActiveThread(state) {
  return state.threads.get(state.activeThreadId) ?? null;
}

/** List threads in insertion order (Maps preserve insertion). */
export function listThreads(state) {
  return [...state.threads.values()];
}

/**
 * Switch the active thread.  No-op (returns same state) when the
 * id doesn't exist OR is already active.
 */
export function setActiveThread(state, id) {
  if (!state.threads.has(id))         return state;
  if (state.activeThreadId === id)    return state;
  return { ...state, activeThreadId: id };
}

/**
 * Create a new thread + switch to it.  Returns the new state + the
 * new thread's id (so the caller can scroll-to-active or similar).
 *
 * @returns {{ state: ThreadState, newId: string }}
 */
export function createThread(state, { name, peerAddr = null, now = Date.now } = {}) {
  const id = nextThreadId();
  const entry = {
    id,
    name:             String(name ?? '').trim() || id,
    createdAt:        now(),
    messages:         [],
    sourceDispatch:   null,
    pendingFollowUp:  null,
    peerAddr:         peerAddr || null,
  };
  const threads = new Map(state.threads);
  threads.set(id, entry);
  return {
    state: { threads, activeThreadId: id },
    newId: id,
  };
}

/**
 * Bundle H (#268, 2026-05-27) — find OR create the DM thread paired
 * with `peerAddr`.  Mirror of web's `ensureDmThread` in
 * `apps/canopy-chat/web/main.js:1121`.  Returns the new state + the
 * thread's id; DOES NOT switch the active thread (peer-router fires
 * silently, the user shouldn't be yanked away from what they were
 * typing).  Caller decides activation policy.
 *
 * @param {ThreadState} state
 * @param {object}      args
 * @param {string}      args.peerAddr
 * @param {string}      [args.nameFallback]   used when no thread exists yet — e.g. "DM: peer-abcd…"
 * @returns {{ state: ThreadState, threadId: string }}
 */
export function ensureDmThread(state, { peerAddr, nameFallback, now = Date.now } = {}) {
  if (typeof peerAddr !== 'string' || peerAddr === '') {
    return { state, threadId: state.activeThreadId };
  }
  for (const entry of state.threads.values()) {
    if (entry.peerAddr === peerAddr) return { state, threadId: entry.id };
  }
  const id = nextThreadId();
  const fallback = nameFallback ?? `DM: ${peerAddr.slice(0, 12)}…`;
  const entry = {
    id,
    name:             fallback,
    createdAt:        now(),
    messages:         [],
    sourceDispatch:   null,
    pendingFollowUp:  null,
    peerAddr,
  };
  const threads = new Map(state.threads);
  threads.set(id, entry);
  return {
    state: { ...state, threads },     // activeThreadId unchanged
    threadId: id,
  };
}

/**
 * Bundle H (#268) — rename every DM thread paired with `peerAddr`
 * to use `displayName`.  Idempotent.  Mirror of web's
 * `updateDmPeerDisplay`.
 */
export function updatePeerDisplay(state, { peerAddr, displayName }) {
  if (typeof peerAddr !== 'string' || !peerAddr) return state;
  if (typeof displayName !== 'string' || !displayName.trim()) return state;
  const newName = `DM: ${displayName.trim()}`;
  let changed = false;
  const threads = new Map(state.threads);
  for (const [id, entry] of threads) {
    if (entry.peerAddr !== peerAddr) continue;
    if (entry.name === newName) continue;
    threads.set(id, { ...entry, name: newName });
    changed = true;
  }
  return changed ? { ...state, threads } : state;
}

/**
 * Delete a thread.  When the deleted thread was active, falls back
 * to the FIRST remaining thread (or null if none left).  The 'main'
 * thread cannot be deleted — guards return same state in that case.
 */
export function deleteThread(state, id) {
  if (id === DEFAULT_THREAD_ID)     return state;     // main is permanent
  if (!state.threads.has(id))       return state;
  const threads = new Map(state.threads);
  threads.delete(id);
  let activeThreadId = state.activeThreadId;
  if (activeThreadId === id) {
    const remaining = [...threads.keys()];
    activeThreadId = remaining[0] ?? DEFAULT_THREAD_ID;
  }
  return { threads, activeThreadId };
}

/**
 * Append a message to a specific thread.  Returns new state with
 * the target thread's messages array updated.  Other threads keep
 * their identity (cheap re-renders).
 */
export function appendMessage(state, threadId, msg) {
  const target = state.threads.get(threadId);
  if (!target) return state;
  const next = { ...target, messages: [...target.messages, msg] };
  const threads = new Map(state.threads);
  threads.set(threadId, next);
  return { ...state, threads };
}

/**
 * Patch (or replace) a specific message in a thread.  Used for the
 * pending → resolved transition (#253 step 1) + state-morphing
 * in-place rendered refresh (#253 step 3).
 *
 * `patch` is either an object merged into the message, or a function
 * (oldMsg) => newMsg.  Returns same state when the message isn't
 * found (defensive).
 */
export function patchMessage(state, threadId, messageId, patch) {
  const target = state.threads.get(threadId);
  if (!target) return state;
  const idx = target.messages.findIndex((m) => m.id === messageId);
  if (idx < 0) return state;
  const oldMsg = target.messages[idx];
  const newMsg = typeof patch === 'function' ? patch(oldMsg) : { ...oldMsg, ...patch };
  const newMessages = target.messages.slice();
  newMessages[idx] = newMsg;
  const next = { ...target, messages: newMessages };
  const threads = new Map(state.threads);
  threads.set(threadId, next);
  return { ...state, threads };
}

/**
 * Record (or clear) the source dispatch for a thread.  Stored to
 * support state-morphing list refresh (#253 step 3) — when a row
 * button is tapped, refreshList re-runs this dispatch + updates
 * the list bubble.
 */
export function setSourceDispatch(state, threadId, sourceDispatch) {
  const target = state.threads.get(threadId);
  if (!target) return state;
  if (target.sourceDispatch === sourceDispatch) return state;
  const next = { ...target, sourceDispatch };
  const threads = new Map(state.threads);
  threads.set(threadId, next);
  return { ...state, threads };
}

/**
 * Record (or clear) the single-field follow-up shape on a thread
 * (#253 step 4).  Switching threads must NOT carry a pending
 * follow-up across — each thread holds its own.
 */
export function setPendingFollowUp(state, threadId, pending) {
  const target = state.threads.get(threadId);
  if (!target) return state;
  if (target.pendingFollowUp === pending) return state;
  const next = { ...target, pendingFollowUp: pending };
  const threads = new Map(state.threads);
  threads.set(threadId, next);
  return { ...state, threads };
}

/**
 * Replace a thread's messages array via a transform.  Used by
 * ChatScreen for batched updates like the bubble-pair append + the
 * pending → resolved patch in dispatchAndAppend (where doing two
 * sequential mutators would re-render twice).
 *
 * The transform receives the current messages array and must return
 * either a NEW array (replaces) or the SAME array (no-op — returns
 * same state to short-circuit the re-render).
 */
export function updateMessages(state, threadId, fn) {
  const target = state.threads.get(threadId);
  if (!target) return state;
  const nextMessages = fn(target.messages);
  if (nextMessages === target.messages) return state;
  const next = { ...target, messages: nextMessages };
  const threads = new Map(state.threads);
  threads.set(threadId, next);
  return { ...state, threads };
}
