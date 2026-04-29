/**
 * wsHub.js — WebSocket broadcast hub.
 *
 * Wraps a `ws.WebSocketServer` and a SyncEngine so engine events are mirrored
 * to every connected client.
 *
 * Broadcast contract (matches the comment block at the top of routes.js):
 *
 *   { type: 'status',            ts, ... }
 *   { type: 'sync.progress',     ts, phase, relPath?, ... }
 *   { type: 'sync.done',         ts, uploads, downloads, deletes, conflicts }
 *   { type: 'sync.force.start',  ts }                              (Folio v2.5)
 *   { type: 'sync.force.done',   ts, uploads, errors }             (Folio v2.5)
 *   { type: 'sync.delete.done',  ts, relPath, podUri }             (Folio v2.11)
 *   { type: 'conflict.new',      ts, id, relPath, podUri }
 *   { type: 'error',             ts, phase, relPath?, message }
 *   { type: 'auth.swapped',      ts, webid }                       (Folio v2.1)
 *   { type: 'diagnostics.step',  ts, idx, total, id, label, status, detail? }
 *                                                                  (Folio v2.3)
 *   { type: 'diagnostics.done',  ts, ok, counts, abortReason?,
 *                                recommendedFix? }                 (Folio v2.3)
 *
 * The `diagnostics.*` frames are broadcast by the POST /diagnostics route
 * handler (see routes.js); the hub doesn't subscribe to a diagnostics
 * source on the engine — runs are kicked off by HTTP, not by SyncEngine.
 *
 * All events carry a millisecond `ts`.  Clients are expected to ignore types
 * they don't understand (forward-compat).
 *
 * Lifecycle:
 *   const hub = new WsHub({ engine });
 *   hub.attach(httpServer);   // mounts a WebSocketServer at path '/events'
 *   hub.broadcast({ ... });   // server-side push (used by /sync/now)
 *   hub.close();              // disconnects clients, unsubscribes from engine
 */

import { WebSocketServer } from 'ws';

import { conflictIdFromRelPath } from './conflictId.js';

const WS_PATH = '/events';

export class WsHub {
  #engine;
  #wss = null;
  #unsubs = [];

  constructor({ engine }) {
    if (!engine) throw new Error('WsHub: engine is required');
    this.#engine = engine;
    this.#wireEngine();
  }

  /**
   * Attach the WebSocketServer to an existing http.Server.  Done as a
   * separate step so callers can construct the server (express -> http) and
   * then layer the WS path on top without coupling the route table.
   *
   * @param {import('http').Server} httpServer
   */
  attach(httpServer) {
    if (this.#wss) throw new Error('WsHub: already attached');
    this.#wss = new WebSocketServer({ server: httpServer, path: WS_PATH });
    this.#wss.on('connection', (socket) => {
      // Greet new clients with a status snapshot so UIs can paint immediately.
      try {
        socket.send(JSON.stringify({
          type:  'status',
          ts:    Date.now(),
          stats: this.#engine.stats ?? {},
          watching: !!this.#engine.__watching,
        }));
      } catch { /* socket may have closed mid-send */ }
    });
    // Swallow noisy "client disconnected mid-send" errors so they don't crash.
    this.#wss.on('error', () => {});
  }

  /**
   * Broadcast a JSON-serializable payload to every connected client.
   * Adds a `ts` field if not present.  Never throws.
   */
  broadcast(payload) {
    if (!this.#wss) return;
    const enriched = { ts: Date.now(), ...payload };
    const json = JSON.stringify(enriched);
    for (const client of this.#wss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        try { client.send(json); } catch { /* ignore */ }
      }
    }
  }

  /** Close the WebSocketServer, drop engine subscriptions. */
  async close() {
    for (const unsub of this.#unsubs) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.#unsubs = [];
    if (!this.#wss) return;
    const wss = this.#wss;
    this.#wss = null;
    await new Promise((resolve) => {
      try {
        for (const client of wss.clients) {
          try { client.terminate(); } catch { /* ignore */ }
        }
        wss.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #wireEngine() {
    const onSynced = (s) => {
      this.broadcast({
        type:      'sync.done',
        uploads:   s?.uploads   ?? 0,
        downloads: s?.downloads ?? 0,
        deletes:   s?.deletes   ?? 0,
        conflicts: s?.conflicts ?? 0,
      });
    };
    const onConflict = (c) => {
      this.broadcast({
        type:    'conflict.new',
        id:      conflictIdFromRelPath(c?.relPath ?? ''),
        relPath: c?.relPath ?? '',
        podUri:  c?.podUri ?? '',
      });
    };
    const onError = (e) => {
      this.broadcast({
        type:    'error',
        phase:   e?.phase ?? 'unknown',
        relPath: e?.relPath ?? null,
        message: e?.err?.message ?? String(e?.err ?? 'unknown'),
      });
    };
    // Folio.B4 — version.new is emitted by SyncEngine on every successful
    // captureVersion (push, pull, conflict-write, conflict-resolve).  The
    // history pane subscribes and refreshes when its current selection
    // matches.
    const onVersionNew = (v) => {
      // Frame shape per spec: { type: 'version.new', ts, relPath } — `ts`
      // is the version's own timestamp.  broadcast() does
      // `{ ts: Date.now(), ...payload }`, so a payload-provided `ts`
      // overrides the wall-clock default.
      this.broadcast({
        type:    'version.new',
        ts:      v?.ts ?? Date.now(),
        relPath: v?.relPath ?? '',
      });
    };

    // Folio v2.1 — `auth.swapped` is fired by the auth-callback path on a
    // successful PodClient hot-swap.  Frame carries ONLY the webid; never
    // any tokens (hard rule per spec).
    const onAuthSwapped = (a) => {
      this.broadcast({
        type:  'auth.swapped',
        ts:    a?.ts ?? Date.now(),
        webid: a?.webid ?? null,
      });
    };

    // Folio v2.5 — force-push lifecycle.  Engine emits the start frame at
    // the very beginning of #forcePushInternal and the done frame after every
    // file has been attempted (errors don't abort the run).
    const onForceStart = (s) => {
      this.broadcast({
        type: 'sync.force.start',
        ts:   s?.ts ?? Date.now(),
      });
    };
    const onForceDone = (s) => {
      this.broadcast({
        type:    'sync.force.done',
        ts:      s?.ts ?? Date.now(),
        uploads: s?.uploads ?? 0,
        errors:  s?.errors ?? 0,
      });
    };

    // Folio v2.11 — permanent pod-delete.  Emitted by SyncEngine.deleteCompletely
    // after the pod resource is gone, the local copy is unlinked, knownState +
    // version history are wiped.  Local-only tombstone (deleteLocal) does NOT
    // emit a frame — the next runOnce surfaces it via the existing `sync.done`
    // frame's `deletes` count.
    const onDeleteDone = (d) => {
      this.broadcast({
        type:    'sync.delete.done',
        ts:      d?.ts ?? Date.now(),
        relPath: d?.relPath ?? '',
        podUri:  d?.podUri ?? '',
      });
    };

    this.#engine.on('synced',           onSynced);
    this.#engine.on('conflict',         onConflict);
    this.#engine.on('error',            onError);
    this.#engine.on('version.new',      onVersionNew);
    this.#engine.on('auth.swapped',     onAuthSwapped);
    this.#engine.on('sync.force.start', onForceStart);
    this.#engine.on('sync.force.done',  onForceDone);
    this.#engine.on('sync.delete.done', onDeleteDone);

    this.#unsubs.push(() => this.#engine.off('synced',           onSynced));
    this.#unsubs.push(() => this.#engine.off('conflict',         onConflict));
    this.#unsubs.push(() => this.#engine.off('error',            onError));
    this.#unsubs.push(() => this.#engine.off('version.new',      onVersionNew));
    this.#unsubs.push(() => this.#engine.off('auth.swapped',     onAuthSwapped));
    this.#unsubs.push(() => this.#engine.off('sync.force.start', onForceStart));
    this.#unsubs.push(() => this.#engine.off('sync.force.done',  onForceDone));
    this.#unsubs.push(() => this.#engine.off('sync.delete.done', onDeleteDone));
  }
}
