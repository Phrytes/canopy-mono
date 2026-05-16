/**
 * syncEngineAdapter — present a cache-mode PseudoPod as the `podClient`
 * surface `@canopy/sync-engine`'s `SyncEngine` already consumes.
 *
 * P3 (sync-engine → pseudo-pod V1 absorption). SyncEngine is left
 * completely ignorant of pseudo-pod: instead of handing it a raw
 * `@canopy/pod-client` PodClient, callers hand it the object this
 * factory returns. SyncEngine's scan/diff/watch/versioning logic is
 * unchanged; its reads/writes now flow through pseudo-pod's
 * write-through queue + read cache (offline durability, drain-on-
 * reconnect) instead of hitting the pod directly.
 *
 * Surface SyncEngine + scanPod actually consume (verified against
 * `packages/sync-engine/src/{SyncEngine,scanPod}.js`):
 *   - read(uri, { decode: 'string' | 'bytes' })
 *       → { content, etag?, size?, lastModified? }; throws NOT_FOUND on miss
 *   - write(uri, content, { contentType?, force? })
 *   - list(containerUri, { recursive?: false })
 *       → { container, entries: [{ uri, type }] }
 *   - createContainer(uri)              — optional (guarded by SyncEngine)
 *   - deleteLocal / deleteCompletely / delete(uri) — optional
 * `exists`/`head` are deliberately NOT provided: SyncEngine.verifyPodState
 * has a documented `read({decode:'bytes'})` fallback, so omitting them
 * keeps the surface minimal without changing behaviour.
 *
 * Read/write/list ride the pseudo-pod (cache benefit). Pod-structural
 * ops (createContainer, the tombstone deletes) are NOT modelled by
 * pseudo-pod — they delegate to an optional underlying real
 * `podClient`. Phase A (substrate-only) runs with none injected; Phase
 * B wires the real PodClient as both pseudo-pod's podUploader/podFetcher
 * AND this adapter's structural delegate.
 *
 * @typedef {import('./PseudoPod.js')} _PP
 */

const NOT_FOUND = (uri) =>
  Object.assign(new Error(`syncEngineAdapter: not found: ${uri}`), { code: 'NOT_FOUND' });

/** Coerce a stored pseudo-pod value into raw bytes (Uint8Array). */
function toBytes(value) {
  if (value == null) return new Uint8Array();
  if (value instanceof Uint8Array) return value;            // Buffer is a Uint8Array
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  // Last resort — should not happen for well-typed SyncEngine writes
  // (it writes a Buffer from fs.readFile, or a string on download).
  return new TextEncoder().encode(JSON.stringify(value));
}

/** Decode a stored value to the string SyncEngine expects for decode:'string'. */
function toStringContent(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array)  return new TextDecoder().decode(value);
  if (value instanceof ArrayBuffer)  return new TextDecoder().decode(new Uint8Array(value));
  return String(value ?? '');
}

/**
 * @param {object}  opts
 * @param {object}  opts.pseudoPod   — a `createPseudoPod(...)` instance in `cache` mode.
 * @param {object}  [opts.podClient] — the underlying real PodClient, for pod-structural
 *   ops pseudo-pod doesn't model (createContainer + the tombstone deletes). Optional:
 *   Phase A substrate tests pass none; Phase B wires the real one.
 * @returns {object} a `podClient`-shaped object for `SyncEngine`.
 */
export function createSyncEnginePodClient({ pseudoPod, podClient } = {}) {
  if (!pseudoPod || typeof pseudoPod.read !== 'function' || typeof pseudoPod.write !== 'function') {
    throw Object.assign(
      new Error('createSyncEnginePodClient: `pseudoPod` (cache-mode createPseudoPod instance) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  /**
   * SyncEngine/scanPod read. pseudo-pod cache mode: local hit, else
   * fall through to the pod (podFetcher) and cache. Returns `null` on a
   * genuine miss AND — by pseudo-pod's documented contract — on a
   * transient pod/network error (it treats those as a miss). We map
   * `null` → NOT_FOUND, which SyncEngine's download path treats as
   * "tombstone GC'd, skip" and scanPod treats as "removed mid-scan".
   * NOTE (Phase B/parity): a transient pod error therefore looks like a
   * skipped download rather than an error — the parity harness must
   * cover this divergence from the direct-PodClient path.
   */
  async function read(uri, opts = {}) {
    const rec = await pseudoPod.read(uri);
    if (!rec) throw NOT_FOUND(uri);
    const decode = opts && opts.decode === 'bytes' ? 'bytes' : 'string';
    const bytes = toBytes(rec.bytes);
    return {
      content: decode === 'bytes' ? bytes : toStringContent(rec.bytes),
      ...(rec.etag != null ? { etag: rec.etag } : {}),
      size: bytes.byteLength,
      // pseudo-pod does not track Last-Modified; scanPod's
      // parseLastModified(null) → 0 and verifyPodState tolerates absence.
      lastModified: undefined,
    };
  }

  /**
   * SyncEngine write. pseudo-pod cache mode queues the write-through and
   * (when reachable) uploads via podUploader.
   *
   * NOTE (Phase B / OQ-3): SyncEngine passes `{ contentType }`, but
   * pseudo-pod's `podUploader(uri, bytes, etag)` has no content-type
   * slot, so the type is not carried to the real pod through this seam.
   * Folio notes are `.md`; Phase B's podUploader must infer content-type
   * from the URI extension (pod-client already does this) — flagged for
   * the Phase B wiring, not an adapter concern.
   *
   * `force:true` (SyncEngine's "skip If-Match handshake") is a no-op
   * here: pseudo-pod's write does not do an If-Match handshake at this
   * layer, so adapter writes are already unconditional.
   */
  async function write(uri, content, _opts = {}) {
    return pseudoPod.write(uri, content);
  }

  /**
   * scanPod uses `list` to discover what exists *on the pod* (to compute
   * downloads). Crucially, `pseudoPod.list` only enumerates the LOCAL
   * cache backend — it never falls through to the pod — so a fresh cache
   * would make scanPod see an empty pod and download nothing. Therefore,
   * when a real podClient is present, `list` must return **pod truth**
   * by delegating to it (scanPod then `read`s each entry, which DOES
   * cache-fall-through via the adapter's `read`). Only with no real
   * podClient (Phase A substrate tests) do we fall back to the flat
   * `pseudoPod.list` shape.
   */
  async function list(containerUri, opts = {}) {
    if (podClient && typeof podClient.list === 'function') {
      // The real podClient already returns scanPod's expected shape
      // ({ container, entries:[{uri,type}] }) — SyncEngine consumes it
      // directly today, so pass it straight through.
      return podClient.list(containerUri, opts);
    }
    const keys = await pseudoPod.list(containerUri);
    return {
      container: containerUri,
      entries: keys.map((uri) => ({ uri, type: 'resource' })),
    };
  }

  /**
   * pseudo-pod is flat — it has no containers. Delegate to the real
   * podClient when present (the real Solid pod does need its parent
   * containers ensured; SyncEngine's 412/CONFLICT-as-success semantics
   * are preserved by letting the real client throw exactly as before).
   * With no real podClient (Phase A) this is a successful no-op.
   */
  async function createContainer(uri) {
    if (podClient && typeof podClient.createContainer === 'function') {
      return podClient.createContainer(uri);
    }
    return undefined;
  }

  /**
   * Tombstone deletes are a real-pod concern pseudo-pod doesn't model
   * (cache-mode `pseudoPod.delete` only evicts the local backend, never
   * touching the real pod). Delegate the tombstone to the real podClient
   * AND evict the local cache so a deleted file is never re-served from
   * cache on a later read/scan.
   */
  async function deleteLocal(uri) {
    if (podClient && typeof podClient.deleteLocal === 'function') {
      await podClient.deleteLocal(uri);
    }
    await pseudoPod.delete(uri).catch(() => {});
  }

  async function deleteCompletely(uri) {
    if (podClient && typeof podClient.deleteCompletely === 'function') {
      await podClient.deleteCompletely(uri);
    } else if (podClient && typeof podClient.delete === 'function') {
      await podClient.delete(uri);
    }
    await pseudoPod.delete(uri).catch(() => {});
  }

  async function deleteResource(uri) {
    if (podClient && typeof podClient.delete === 'function') {
      await podClient.delete(uri);
    }
    await pseudoPod.delete(uri).catch(() => {});
  }

  return {
    read,
    write,
    list,
    createContainer,
    deleteLocal,
    deleteCompletely,
    delete: deleteResource,
    // Introspection (tests / Phase B wiring).
    get _pseudoPod() { return pseudoPod; },
    get _podClient() { return podClient ?? null; },
  };
}
