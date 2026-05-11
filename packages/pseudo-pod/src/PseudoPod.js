/**
 * PseudoPod — the Solid-shaped local store at the heart of the
 * substrate-layer V2 work.
 *
 * V0 ships two modes:
 *   - `standalone`        — single-device, no fan-out. Local store
 *                           is the canonical source of truth.
 *   - `replication-ring`  — every write is eagerly fanned out to
 *                           peers via `transport.publishEnvelope`.
 *                           Local store is still canonical; peers
 *                           reconcile via `writeFromPeer`.
 *
 * Cache mode (with a real pod attached) ships in V1 — Phase 52.8.
 *
 * URI scheme:
 *   `pseudo-pod://<deviceId>/<path>` — V0 only handles these.
 *   `https://...` URIs route via `pod-client` once Phase 52.6 lands.
 *
 * Standardisation Phase 52.2 — see
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
 * and the functional design §4.1.
 *
 * @typedef {import('./StorageBackend.js').StorageBackend} StorageBackend
 * @typedef {'standalone'|'replication-ring'} PseudoPodMode
 */

import { makeFetchResourceSkill } from '@canopy/core';

/** Envelope kind used for replication-ring fan-out in V0.
 *  Phase 52.4 (`notify-envelope`) will own this string. */
const REPLICATION_KIND = 'pseudo-pod.write';

/**
 * @param {object} opts
 * @param {StorageBackend} opts.backend           — required.
 * @param {PseudoPodMode}  opts.mode              — 'standalone' or 'replication-ring'.
 * @param {string}         opts.deviceId          — short id used in URIs (e.g. 'laptop-xyz').
 * @param {object}         [opts.transport]       — required iff mode is 'replication-ring'.
 * @param {() => string[]} [opts.getPeers]        — required iff mode is 'replication-ring'.
 * @param {string}         [opts.fromActor]       — agent-uri tagged on outbound envelopes.
 */
export function createPseudoPod({
  backend,
  mode,
  deviceId,
  transport,
  getPeers,
  fromActor,
} = {}) {
  if (!backend || typeof backend.get !== 'function') {
    throw Object.assign(
      new Error('createPseudoPod: `backend` (StorageBackend) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (mode !== 'standalone' && mode !== 'replication-ring') {
    throw Object.assign(
      new Error('createPseudoPod: `mode` must be "standalone" or "replication-ring"'),
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

  const uriPrefix = `pseudo-pod://${deviceId}/`;

  /**
   * Translate a `pseudo-pod://<deviceId>/<path>` URI to the backend
   * key (the URI itself — keeps semantics simple) and validate the
   * scheme + device-match.
   */
  function _keyForUri(uri) {
    if (typeof uri !== 'string') {
      throw Object.assign(
        new Error('pseudo-pod: uri must be a string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!uri.startsWith('pseudo-pod://')) {
      throw Object.assign(
        new Error(`pseudo-pod: unsupported scheme in "${uri}" — only pseudo-pod:// in V0`),
        { code: 'UNSUPPORTED_SCHEME' },
      );
    }
    return uri;   // use the URI directly as the storage key
  }

  /** Is this URI local to *this* device? */
  function _isLocalUri(uri) {
    return uri.startsWith(uriPrefix);
  }

  async function read(uri) {
    const key = _keyForUri(uri);
    const rec = await backend.get(key);
    if (!rec) return null;
    return { uri, bytes: rec.bytes, ...(rec.etag != null ? { etag: rec.etag } : {}) };
  }

  async function write(uri, bytes, etag) {
    const key = _keyForUri(uri);
    if (!_isLocalUri(uri)) {
      throw Object.assign(
        new Error(`pseudo-pod: cannot write to non-local URI "${uri}" (deviceId mismatch)`),
        { code: 'NOT_LOCAL' },
      );
    }
    const newEtag = await backend.put(key, bytes, etag);

    if (mode === 'replication-ring') {
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

    return { uri, etag: newEtag };
  }

  async function deleteResource(uri) {
    const key = _keyForUri(uri);
    if (!_isLocalUri(uri)) {
      throw Object.assign(
        new Error(`pseudo-pod: cannot delete non-local URI "${uri}"`),
        { code: 'NOT_LOCAL' },
      );
    }
    await backend.delete(key);
  }

  async function list(containerUri) {
    if (typeof containerUri !== 'string') {
      throw Object.assign(
        new Error('pseudo-pod.list: containerUri must be a string'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!containerUri.startsWith('pseudo-pod://')) {
      throw Object.assign(
        new Error('pseudo-pod.list: V0 only supports pseudo-pod:// URIs'),
        { code: 'UNSUPPORTED_SCHEME' },
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
   * V0 stub for cache-mode flush (no-op). V1 will write through to
   * the real pod here.
   */
  async function flush(_uri) {
    return;
  }

  /**
   * V0 has a single global mode. Per-URI overrides ship with cache
   * mode in V1; until then this returns the global setting.
   */
  function modeForUri(_uri) {
    return mode;
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
    fetchResourceSkill,

    // Introspection
    get deviceId() { return deviceId; },
    get backend()  { return backend; },
    get currentMode() { return mode; },
  };
}
