/**
 * folio — pure agent cores for the NODE ops (Slice 1c, follow-up to Slice 1b's
 * browser cores in `agentCores.js`; PLAN-folio-as-file-agent.md).
 *
 * These are the `runtime:'node'` manifest ops — folio's local-SyncEngine
 * control surface (`syncOnce`, `watchStart`, `watchStop`, `forceRepush`,
 * `deleteLocally`).  Unlike the browser cores (relocatable pod-file ops that
 * canopy-chat exposes in its browser bundle), these drive the real
 * `@onderling/sync-engine` `SyncEngine` — chokidar watcher, save-detection,
 * fs ↔ pod reconciliation — which needs Node + the local filesystem in reach.
 * They therefore live in a SEPARATE file from the browser cores so nothing on
 * the browser path (`browser.js` → `wireSkills.js` → `agentCores.js`) ever
 * imports engine/node code, not even transitively.
 *
 * Uniform-route shape (decision #5), identical to the browser cores: each core
 * is a pure `(store, args, ctx) → result` over an injected `store`.  Here the
 * store threads the live SyncEngine as `store.engine`:
 *
 *   store = {
 *     engine,   // the folio SyncEngine (runOnce / start / stop / forcePush /
 *               // deleteLocal + the `__watching` intent flag the routes use)
 *   }
 *
 * Each core calls THE SAME engine method the corresponding HTTP route calls
 * (see `src/server/routes.js`) so behaviour is preserved:
 *
 *   syncOnce      → engine.runOnce({ direction: 'both' })   (route: POST /sync/now)
 *   watchStart    → engine.start()  + engine.__watching     (route: POST /watch/start)
 *   watchStop     → engine.stop()   + engine.__watching     (route: POST /watch/stop)
 *   forceRepush   → engine.forcePush()                      (route: POST /sync/force)
 *   deleteLocally → engine.deleteLocal(relPath)             (route: POST /rm/:id)
 *
 * The routes are fire-and-forget for the streaming ops (202 + WebSocket
 * progress frames); a wire-skill invocation is request/response, so these
 * cores AWAIT the engine and return its real result.  Honest
 * `{ ok:false, error }` on a boundary miss (no engine / method absent),
 * matching the browser cores' style.
 *
 * Import-free (like `agentCores.js` / `apps/agents/src/cores.js`) — the engine
 * is threaded via `store`, so this module drags no node/engine deps of its own.
 */

/** Resolve the engine from the store, or return an honest boundary-miss error. */
function engineOf(store) {
  const engine = store?.engine;
  if (!engine) return { engine: null, miss: { ok: false, error: 'no sync engine in reach (node-only op)' } };
  return { engine, miss: null };
}

/* ── syncOnce — one-shot bi-directional sync (route: POST /sync/now) ── */
export async function syncOnce(store /*, args, ctx */) {
  const { engine, miss } = engineOf(store);
  if (miss) return miss;
  if (typeof engine.runOnce !== 'function') return { ok: false, error: 'engine has no runOnce()' };
  const stats = await engine.runOnce({ direction: 'both' });
  return { ok: true, ...stats };
}

/* ── watchStart — start the local-folder watcher (route: POST /watch/start) ── */
export function watchStart(store /*, args, ctx */) {
  const { engine, miss } = engineOf(store);
  if (miss) return miss;
  if (typeof engine.start !== 'function') return { ok: false, error: 'engine has no start()' };
  // Mirror the route exactly: idempotent on the `__watching` intent flag.
  if (!engine.__watching) {
    engine.start();
    engine.__watching = true;
  }
  return { ok: true, watching: true };
}

/* ── watchStop — stop the local-folder watcher (route: POST /watch/stop) ── */
export async function watchStop(store /*, args, ctx */) {
  const { engine, miss } = engineOf(store);
  if (miss) return miss;
  if (typeof engine.stop !== 'function') return { ok: false, error: 'engine has no stop()' };
  if (engine.__watching) {
    await engine.stop();
    engine.__watching = false;
  }
  return { ok: true, watching: false };
}

/* ── forceRepush — re-upload every local file (route: POST /sync/force) ── */
export async function forceRepush(store /*, args, ctx */) {
  const { engine, miss } = engineOf(store);
  if (miss) return miss;
  if (typeof engine.forcePush !== 'function') return { ok: false, error: 'engine has no forcePush()' };
  const r = await engine.forcePush();
  return { ok: true, ...r };
}

/* ── deleteLocally — local-only tombstone; pod copy survives (route: POST /rm/:id) ── */
export async function deleteLocally(store, args = {}) {
  const relPath = String(args.relPath ?? '').trim();
  if (!relPath) return { ok: false, error: 'relPath required' };
  const { engine, miss } = engineOf(store);
  if (miss) return miss;
  if (typeof engine.deleteLocal !== 'function') return { ok: false, error: 'engine has no deleteLocal()' };
  await engine.deleteLocal(relPath);
  return { ok: true, relPath };
}

/**
 * The manifest-derived NODE core map — EXACTLY the folioManifest ops tagged
 * `runtime:'node'` (the local-SyncEngine control surface).
 * `buildFolioNodeSkills` wireSkill-wraps each; the node fitness test asserts
 * route parity against the manifest (a node op with no core here, or a core
 * with no node op, fails CI — the anti-drift guarantee).
 */
export const FOLIO_NODE_CORES = Object.freeze({
  syncOnce,
  watchStart,
  watchStop,
  forceRepush,
  deleteLocally,
});
