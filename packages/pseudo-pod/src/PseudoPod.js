/**
 * PseudoPod — the Solid-shaped local store at the heart of the
 * substrate-layer V2 work.
 *
 * V0 (Phase 52.2) ships two modes:
 *   - `standalone`        — single-device, no fan-out. Local store
 *                           is the canonical source of truth.
 *   - `replication-ring`  — every write is eagerly fanned out to
 *                           peers via `transport.publishEnvelope`.
 *                           Local store is still canonical; peers
 *                           reconcile via `writeFromPeer`.
 *
 * V1 (Phase 52.8) adds:
 *   - `cache`             — local-immediate writes are queued for
 *                           write-through to a real pod via the
 *                           injected `podUploader`. Reads fall through
 *                           to `podFetcher` on local miss + cache the
 *                           result. Graceful degradation: when
 *                           `isPodReachable(uri)` returns false, the
 *                           write stays queued until `drainWriteThroughQueue()`
 *                           is invoked.
 *   - **Per-URI mode override** (`setMode(uri, mode)`): a single
 *                           PseudoPod can run different modes for
 *                           different resources (e.g. notes in cache;
 *                           buurt items in replication-ring).
 *
 * URI scheme:
 *   `pseudo-pod://<deviceId>/<path>` — local namespace.
 *   `https://...` URIs — cache-mode only.
 *
 * Standardisation Phase 52.2 + 52.8 — see
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
 * and the functional design §4.1.
 *
 * @typedef {import('./StorageBackend.js').StorageBackend} StorageBackend
 * @typedef {'standalone'|'replication-ring'|'cache'} PseudoPodMode
 */

import { makeFetchResourceSkill }    from '@canopy/core';
import { createWriteThroughQueue }   from './writeThroughQueue.js';

/** Envelope kind used for replication-ring fan-out in V0.
 *  Phase 52.4 (`notify-envelope`) will own this string. */
const REPLICATION_KIND = 'pseudo-pod.write';

const VALID_MODES = new Set(['standalone', 'replication-ring', 'cache']);

/**
 * @param {object} opts
 * @param {StorageBackend} opts.backend           — required.
 * @param {'standalone'|'replication-ring'|'cache'} opts.mode  — global default mode.
 * @param {string}         opts.deviceId          — short id used in URIs (e.g. 'laptop-xyz').
 * @param {object}         [opts.transport]       — required iff mode is 'replication-ring'.
 * @param {() => string[]} [opts.getPeers]        — required iff mode is 'replication-ring'.
 * @param {string}         [opts.fromActor]       — agent-uri tagged on outbound envelopes.
 *
 * V1 (cache mode) opts:
 * @param {(uri: string) => Promise<{bytes: *, etag?: string} | null>} [opts.podFetcher]
 *   — required for cache reads when local has a miss. Wires to pod-client.read.
 * @param {(uri: string, bytes: *, etag?: string) => Promise<{etag?: string} | void>} [opts.podUploader]
 *   — required for cache writes' write-through to the real pod. Wires to pod-client.write.
 * @param {(uri: string) => boolean} [opts.isPodReachable]
 *   — graceful-degradation gate. When supplied, cache-mode writes that find
 *   the pod unreachable stay in the write-through queue until
 *   `drainWriteThroughQueue()` is called on reconnect.
 */
export function createPseudoPod({
  backend,
  mode,
  deviceId,
  transport,
  getPeers,
  fromActor,
  podFetcher,
  podUploader,
  isPodReachable,
} = {}) {
  if (!backend || typeof backend.get !== 'function') {
    throw Object.assign(
      new Error('createPseudoPod: `backend` (StorageBackend) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!VALID_MODES.has(mode)) {
    throw Object.assign(
      new Error('createPseudoPod: `mode` must be "standalone", "replication-ring", or "cache"'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(
      new Error('createPseudoPod: `deviceId` must be a non-empty string'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (mode === 'replication-ring') {
    if (!transport || typeof transport.publishEnvelope !== 'function') {
      throw Object.assign(
        new Error('createPseudoPod: replication-ring mode requires `transport.publishEnvelope`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof getPeers !== 'function') {
      throw Object.assign(
        new Error('createPseudoPod: replication-ring mode requires `getPeers: () => string[]`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
  }
  if (mode === 'cache') {
    if (typeof podUploader !== 'function') {
      throw Object.assign(
        new Error('createPseudoPod: cache mode requires `podUploader`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof podFetcher !== 'function') {
      throw Object.assign(
        new Error('createPseudoPod: cache mode requires `podFetcher`'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
  }

  /** @type {Map<string, 'standalone'|'replication-ring'|'cache'>} */
  const perUriMode = new Map();

  function _modeFor(uri) {
    return perUriMode.get(uri) ?? mode;
  }

  const writeThroughQueue = createWriteThroughQueue({ backend });

  const uriPrefix = `pseudo-pod://${deviceId}/`;

  /**
   * Translate a URI to the backend key (the URI itself — keeps
   * semantics simple). Validates that the input is a non-empty
   * string. Scheme enforcement is split per operation:
   *
   *   - read / list / writeFromPeer  → accept any scheme (the
   *     pseudo-pod is a local cache for peer-replicated resources
   *     regardless of their canonical URI scheme).
   *   - write / delete               → the caller is the owner;
   *     enforced separately to be a local `pseudo-pod://<deviceId>/`
   *     URI via `_assertLocalWrite`.
   */
  function _keyForUri(uri) {
    if (typeof uri !== 'string') {
      throw Object.assign(
        new Error('pseudo-pod: uri must be a string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (uri.length === 0) {
      throw Object.assign(
        new Error('pseudo-pod: uri must be non-empty'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return uri;
  }

  /**
   * Enforce that an outbound write/delete targets THIS device's
   * pseudo-pod namespace. Used by `write` and `delete`.
   */
  function _assertLocalWrite(uri) {
    if (!uri.startsWith('pseudo-pod://')) {
      throw Object.assign(
        new Error(`pseudo-pod: cannot write to non-pseudo-pod URI "${uri}" — V0 only writes to pseudo-pod://`),
        { code: 'UNSUPPORTED_SCHEME' },
      );
    }
    if (!_isLocalUri(uri)) {
      throw Object.assign(
        new Error(`pseudo-pod: cannot write to non-local URI "${uri}" (deviceId mismatch)`),
        { code: 'NOT_LOCAL' },
      );
    }
  }

  /** Is this URI local to *this* device? */
  function _isLocalUri(uri) {
    return uri.startsWith(uriPrefix);
  }

  async function read(uri) {
    const key = _keyForUri(uri);
    const rec = await backend.get(key);
    if (rec) {
      return { uri, bytes: rec.bytes, ...(rec.etag != null ? { etag: rec.etag } : {}) };
    }

    // Cache mode: fall through to the pod on local miss.
    if (_modeFor(uri) === 'cache' && typeof podFetcher === 'function') {
      try {
        const remote = await podFetcher(uri);
        if (remote && remote.bytes !== undefined) {
          await backend.put(key, remote.bytes, remote.etag);
          return { uri, bytes: remote.bytes, ...(remote.etag != null ? { etag: remote.etag } : {}) };
        }
      } catch (_err) {
        // Network errors → treat as a miss. Caller can retry later.
      }
    }
    return null;
  }

  async function write(uri, bytes, etag) {
    const key = _keyForUri(uri);
    const effectiveMode = _modeFor(uri);

    // Standalone + replication-ring writes must be device-local.
    // Cache writes accept https:// (the pod's own URI scheme).
    if (effectiveMode !== 'cache') _assertLocalWrite(uri);

    const newEtag = await backend.put(key, bytes, etag);

    if (effectiveMode === 'replication-ring') {
      const recipients = getPeers().filter(p => typeof p === 'string' && p.length > 0);
      if (recipients.length > 0) {
        try {
          await transport.publishEnvelope({
            kind: REPLICATION_KIND,
            ref:  uri,
            etag: newEtag,
            ...(fromActor != null ? { fromActor } : {}),
            recipients,
            payload: { uri, bytes, etag: newEtag },
          });
        } catch (_err) {
          // Replication is best-effort in V0. V1 will queue retries
          // via the backend's dirty-set.
        }
      }
    }

    if (effectiveMode === 'cache') {
      const reachable = typeof isPodReachable === 'function' ? !!isPodReachable(uri) : true;
      if (reachable) {
        try {
          const result = await podUploader(uri, bytes, newEtag);
          if (result && result.etag) {
            // Pod assigned its own etag — replace our local etag with theirs.
            await backend.put(key, bytes, result.etag);
            return { uri, etag: result.etag };
          }
          return { uri, etag: newEtag };
        } catch (_err) {
          // Upload failed → queue for retry. Caller drains on reconnect.
          await writeThroughQueue.enqueue({ uri, bytes, etag: newEtag });
          return { uri, etag: newEtag, queued: true };
        }
      } else {
        // Pod unreachable up-front → queue immediately (graceful degradation).
        await writeThroughQueue.enqueue({ uri, bytes, etag: newEtag });
        return { uri, etag: newEtag, queued: true };
      }
    }

    return { uri, etag: newEtag };
  }

  async function deleteResource(uri) {
    const key = _keyForUri(uri);
    if (_modeFor(uri) !== 'cache') _assertLocalWrite(uri);
    await backend.delete(key);
  }

  async function list(containerUri) {
    if (typeof containerUri !== 'string' || containerUri.length === 0) {
      throw Object.assign(
        new Error('pseudo-pod.list: containerUri must be a non-empty string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const prefix = containerUri.endsWith('/') ? containerUri : containerUri + '/';
    return backend.list(prefix);
  }

  function subscribe(uri, cb) {
    if (typeof uri !== 'string') {
      throw Object.assign(
        new Error('pseudo-pod.subscribe: uri must be a string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('pseudo-pod.subscribe: cb must be a function'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    return backend.subscribe(uri, cb);
  }

  /**
   * Inbound write from a peer (replication-ring receive path). The
   * `notify-envelope` substrate (Phase 52.4) calls this when an
   * envelope with `kind === 'pseudo-pod.write'` arrives.
   *
   * V0 trust model: identity is already verified at the transport /
   * security-layer level. No additional ACL check here.
   */
  async function writeFromPeer(uri, bytes, etag) {
    const key = _keyForUri(uri);
    // Note: we deliberately accept writes to non-local URIs here —
    // that's the whole point of replication-ring. Each device caches
    // peers' resources locally under their own pseudo-pod://<peer>/...
    // namespace.
    await backend.put(key, bytes, etag);
  }

  /**
   * Force a write-through to the pod for a single URI (cache mode).
   * For non-cache modes this is a no-op. Useful for "flush now"
   * paths (e.g. before close, or when the user explicitly hits "sync").
   */
  async function flush(uri) {
    if (typeof uri !== 'string' || _modeFor(uri) !== 'cache') return;
    if (typeof podUploader !== 'function') return;
    const rec = await backend.get(uri);
    if (!rec) return;
    try {
      const result = await podUploader(uri, rec.bytes, rec.etag);
      if (result && result.etag) await backend.put(uri, rec.bytes, result.etag);
    } catch (_err) {
      // Leave the entry in the queue (or enqueue it) for later drain.
      await writeThroughQueue.enqueue({ uri, bytes: rec.bytes, etag: rec.etag });
    }
  }

  /**
   * Resolve the effective mode for a URI — per-URI override wins,
   * else the global default.
   */
  function modeForUri(uri) {
    return _modeFor(uri);
  }

  /**
   * Pin a URI's effective mode. Passing `null` clears the override
   * (the global default takes over).
   *
   * @param {string} uri
   * @param {'standalone'|'replication-ring'|'cache'|null} m
   */
  function setMode(uri, m) {
    if (typeof uri !== 'string' || uri.length === 0) {
      throw Object.assign(
        new Error('setMode: uri is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (m === null) { perUriMode.delete(uri); return; }
    if (!VALID_MODES.has(m)) {
      throw Object.assign(
        new Error(`setMode: invalid mode "${m}"`),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    perUriMode.set(uri, m);
  }

  /**
   * Drain pending write-through entries (cache-mode V1). Called by
   * the caller when they observe a "pod reachable again" event. The
   * substrate doesn't auto-poll — higher-level code wires
   * reachability detection.
   *
   * @param {object} [opts]
   * @param {(entry: {uri: string, etag?: string, result: {etag?: string} | void}) => Promise<void>} [opts.onSuccess]
   *   — fires per drained entry. Useful for cross-substrate signalling
   *   (e.g. notify-envelope's "ring → pod-canonical" envelope re-emit).
   *
   * @returns {Promise<{drained: number, remaining: number, error?: Error}>}
   */
  async function drainWriteThroughQueue({ onSuccess } = {}) {
    if (typeof podUploader !== 'function') return { drained: 0, remaining: await writeThroughQueue.size() };
    return writeThroughQueue.drain({
      uploadFn: async (entry) => {
        const result = await podUploader(entry.uri, entry.bytes, entry.etag);
        // Pod-assigned etag wins; update the local copy.
        if (result && result.etag) {
          await backend.put(entry.uri, entry.bytes, result.etag);
        }
        return result;
      },
      onSuccess: typeof onSuccess === 'function'
        ? async (entry, result) => onSuccess({ uri: entry.uri, etag: entry.etag, result })
        : undefined,
    });
  }

  async function listWriteThroughPending() {
    return writeThroughQueue.list();
  }

  async function writeThroughPendingCount() {
    return writeThroughQueue.size();
  }

  /**
   * Build the `fetch-resource` skill bound to this pseudo-pod's
   * `read`. Apps register it on their agent so peers can fetch
   * resources from this device:
   *
   *   agent.skills.register(pseudoPod.fetchResourceSkill());
   *
   * The skill itself lives in core (`makeFetchResourceSkill`);
   * pseudo-pod just supplies the storage-backed reader.
   */
  function fetchResourceSkill(opts = {}) {
    return makeFetchResourceSkill({
      read: async (uri) => {
        const rec = await read(uri);
        if (!rec) return null;
        return { bytes: rec.bytes, ...(rec.etag != null ? { etag: rec.etag } : {}) };
      },
      ...opts,
    });
  }

  return {
    read,
    write,
    delete: deleteResource,
    list,
    subscribe,
    writeFromPeer,
    flush,
    mode: modeForUri,
    setMode,
    fetchResourceSkill,

    // Cache-mode V1 surface (Phase 52.8).
    drainWriteThroughQueue,
    listWriteThroughPending,
    writeThroughPendingCount,

    // Introspection
    get deviceId()      { return deviceId; },
    get backend()       { return backend; },
    get currentMode()   { return mode; },
    get _perUriMode()   { return new Map(perUriMode); },
    get _writeThroughQueue() { return writeThroughQueue; },
  };
}
