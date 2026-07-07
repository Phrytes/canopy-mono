/**
 * createNotifyEnvelope — the substrate factory.
 *
 * Combines:
 *   - the per-write mode picker (`pickMode`);
 *   - the pending-pod-upload queue (`createPendingQueue`);
 *   - a wire-level publish path that talks to
 *     `transport.publishEnvelope`;
 *   - a receiver-side dispatcher that hooks
 *     `transport.subscribeEnvelopes`.
 *
 * The caller wires up:
 *   - `transport`  — exposes `publishEnvelope` + `subscribeEnvelopes`.
 *   - `pseudoPod`  — the local Solid-shaped store.
 *   - `podRouting` — for crew policy + reachability.
 *   - `uploadFn`   — optional; the pod-write path (`pod-client` once
 *                    Phase 52.6 lands; tests pass a mock).
 *
 * Standardisation Phase 52.4 — see plan §52.4.
 */

import { pickMode }            from './picker.js';
import { createPendingQueue }  from './pendingQueue.js';

/**
 * @param {object} opts
 * @param {object} opts.transport     — required (publishEnvelope + subscribeEnvelopes)
 * @param {object} opts.pseudoPod     — required (writeFromPeer + backend)
 * @param {object} opts.podRouting    — required (isPodReachable + markPodReachable / markPodUnreachable)
 * @param {(entry: object) => Promise<void>} [opts.uploadFn]
 * @param {object} [opts.queueBackend]   — defaults to `pseudoPod.backend`
 * @param {(...args: any[]) => void} [opts.logger]
 */
export function createNotifyEnvelope({
  transport,
  pseudoPod,
  podRouting,
  uploadFn,
  queueBackend,
  logger,
} = {}) {
  if (!transport || typeof transport.publishEnvelope !== 'function' || typeof transport.subscribeEnvelopes !== 'function') {
    throw Object.assign(
      new Error('createNotifyEnvelope: transport must expose publishEnvelope + subscribeEnvelopes'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!pseudoPod || typeof pseudoPod.writeFromPeer !== 'function') {
    throw Object.assign(
      new Error('createNotifyEnvelope: pseudoPod is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!podRouting || typeof podRouting.isPodReachable !== 'function') {
    throw Object.assign(
      new Error('createNotifyEnvelope: podRouting is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const backend = queueBackend ?? pseudoPod.backend;
  if (!backend) {
    throw Object.assign(
      new Error('createNotifyEnvelope: queueBackend is required (or pseudoPod.backend)'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const queue = createPendingQueue({ backend });

  /** @type {Map<string, Set<(env: object, raw: object) => void>>} */
  const kindSubscribers = new Map();
  /** @type {Set<(env: object, raw: object) => void>} */
  const allSubscribers = new Set();
  /** @type {(() => void) | null} */
  let unsubscribeTransport = null;
  let running = false;

  function _log(...args) { if (typeof logger === 'function') logger(...args); }

  /**
   * Pick the wire shape + publish.
   *
   * @param {object} input
   * @param {string} input.type        — item-types name (becomes envelope `kind`)
   * @param {string} input.ref         — resource URI
   * @param {*}      [input.payload]   — required for full-payload mode
   * @param {string} [input.etag]
   * @param {number} [input._v]        — Lamport version (Phase 52.14, Q-D
   *                                      2026-05-14). Forwarded on full-
   *                                      payload envelopes so receivers
   *                                      can run the version compare.
   *                                      Forward-additive: legacy
   *                                      receivers ignore it.
   * @param {string[]} input.recipients
   * @param {string} [input.fromActor]
   * @param {string} [input.circleId]    — informational (queued in metadata)
   * @returns {Promise<{mode: 'envelope-only'|'full-payload', queued: boolean, decision: object}>}
   */
  async function publish({ type, ref, payload, etag, _v, recipients, fromActor, circleId } = {}) {
    if (typeof type !== 'string' || type.length === 0) {
      throw Object.assign(
        new Error('publish: type is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof ref !== 'string' || ref.length === 0) {
      throw Object.assign(
        new Error('publish: ref is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw Object.assign(
        new Error('publish: recipients must be a non-empty array'),
        { code: 'INVALID_ARGUMENT' },
      );
    }

    const decision = pickMode({ ref, podRouting });

    if (decision.mode === 'envelope-only') {
      await transport.publishEnvelope({
        kind: type,
        ref,
        ...(etag      != null ? { etag }      : {}),
        ...(fromActor != null ? { fromActor } : {}),
        recipients,
      });
      _log('publish: envelope-only', { type, ref });
      return { mode: 'envelope-only', queued: false, decision };
    }

    // full-payload mode
    if (typeof payload === 'undefined') {
      throw Object.assign(
        new Error('publish: full-payload mode requires `payload`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    await transport.publishEnvelope({
      kind: type,
      ref,
      ...(etag      != null ? { etag }      : {}),
      ...(typeof _v === 'number' ? { _v } : {}),
      ...(fromActor != null ? { fromActor } : {}),
      recipients,
      payload,
    });

    let queued = false;
    if (decision.queue) {
      await queue.enqueue({
        uri:        ref,
        payload,
        etag,
        ...(typeof _v === 'number' ? { _v } : {}),
        type,
        recipients,
        fromActor,
        circleId,
      });
      queued = true;
    }
    _log('publish: full-payload', { type, ref, queued });
    return { mode: 'full-payload', queued, decision };
  }

  /**
   * @param {object} args
   * @param {string} args.kind         — item-types name. '*' subscribes to all kinds.
   * @param {(envelope: object, raw: object) => void} args.callback
   * @returns {() => void} unsubscribe
   */
  function subscribe({ kind, callback } = {}) {
    if (typeof callback !== 'function') {
      throw Object.assign(
        new Error('subscribe: callback is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (kind === '*' || kind === undefined) {
      allSubscribers.add(callback);
      return () => { allSubscribers.delete(callback); };
    }
    if (typeof kind !== 'string' || kind.length === 0) {
      throw Object.assign(
        new Error('subscribe: kind must be a non-empty string (or "*")'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    let subs = kindSubscribers.get(kind);
    if (!subs) {
      subs = new Set();
      kindSubscribers.set(kind, subs);
    }
    subs.add(callback);
    return () => {
      subs.delete(callback);
      if (subs.size === 0) kindSubscribers.delete(kind);
    };
  }

  /**
   * Hook into transport.subscribeEnvelopes. For full-payload
   * envelopes, write the payload into the local pseudo-pod via
   * writeFromPeer *before* dispatching subscribers — by the time a
   * callback fires, the resource is locally readable.
   */
  function start() {
    if (running) return;
    running = true;
    unsubscribeTransport = transport.subscribeEnvelopes(async (payload, raw) => {
      if (!payload || typeof payload !== 'object') return;
      const kind = payload.kind;
      const ref  = payload.ref;

      // Full-payload eager fan-out: stash to local pseudo-pod first.
      // Phase 52.14 (Q-D 2026-05-14) — pass `_v` + sender id through so
      // writeFromPeer can run the 3-way version compare and fire
      // 'peer-update' / 'stale-peer' / 'concurrent-write' events.
      if (payload.payload !== undefined && typeof ref === 'string') {
        try {
          const peerV     = typeof payload._v === 'number' ? payload._v : undefined;
          const fromActor = typeof payload.fromActor === 'string' ? payload.fromActor : undefined;
          await pseudoPod.writeFromPeer(
            ref,
            payload.payload,
            payload.etag,
            peerV,
            fromActor != null ? { fromActor } : undefined,
          );
        } catch (err) {
          _log('writeFromPeer failed', { ref, err });
        }
      }

      // Dispatch subscribers.
      const fire = (cb) => { try { cb(payload, raw); } catch (err) { _log('subscriber error', err); } };
      for (const cb of allSubscribers) fire(cb);
      if (typeof kind === 'string') {
        const subs = kindSubscribers.get(kind);
        if (subs) for (const cb of subs) fire(cb);
      }
    });
  }

  function stop() {
    if (!running) return;
    running = false;
    if (typeof unsubscribeTransport === 'function') unsubscribeTransport();
    unsubscribeTransport = null;
  }

  /**
   * Drain pending uploads. Called by the caller when they observe
   * a "pod reachable" event. The substrate doesn't auto-poll;
   * higher-level code wires reachability detection.
   */
  async function drainQueue() {
    if (typeof uploadFn !== 'function') return { drained: 0, remaining: await queue.size() };
    return queue.drain({
      uploadFn: async (entry) => {
        await uploadFn(entry);
        // Mark pod reachable on first success — subsequent writes can use envelope-only.
        if (entry.uri && podRouting.markPodReachable) podRouting.markPodReachable(entry.uri);
      },
      emitFn: async (entry) => {
        // Re-emit envelope-only: "now pod-canonical".
        await transport.publishEnvelope({
          kind: entry.type,
          ref:  entry.uri,
          ...(entry.etag      != null ? { etag:      entry.etag }      : {}),
          ...(entry.fromActor != null ? { fromActor: entry.fromActor } : {}),
          recipients: entry.recipients,
        });
      },
    });
  }

  async function listPending() {
    return queue.list();
  }

  async function pendingCount() {
    return queue.size();
  }

  return {
    publish,
    subscribe,
    start,
    stop,
    drainQueue,
    listPending,
    pendingCount,

    // Introspection
    get running() { return running; },
    get queue()   { return queue; },
  };
}
