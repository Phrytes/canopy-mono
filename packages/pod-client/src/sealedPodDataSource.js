// sealedPodDataSource — a sealed, pod-backed `core.DataSource` (read/write/delete/list).
//
// This is the composition point that lets a per-circle `CircleItemStore` (@onderling/item-store) persist
// to a REAL Solid pod with content sealed at rest under the circle's group key — the L1b tier, unblocking
// the K cross-circle sharing. It ASSEMBLES existing pieces, inventing no scheme + no crypto:
//
//   SolidPodSource(authedFetch, podUrl)     ── pod-backed read/write/delete/list over LDP
//     └─ (adapter: bytes → string body)     ── present it under the minimal PodClient shape
//         └─ createSealedPodClient(strategy) ── transparent seal-on-write / open-on-read (envelope crypto)
//             └─ 4-method DataSource facade   ── the shape CircleItemStore consumes
//
// The seal/open STRATEGY is injected (or derived from a storage POSTURE via `resolveCircleStorage`), so key
// custody stays outside this module (the circle's control-agent / @onderling/vault own the group key). A p0/p1
// posture (or an absent strategy) yields a PLAINTEXT pod-backed source — same 4 methods, no client-side seal.
//
// LAYERING: this lives in @onderling/pod-client (it composes the pod adapter + sealing). It does NOT import
// @onderling/item-store — it only produces the `core.DataSource` contract that item-store depends on. So the
// clean edge holds: apps → item-store → core, and apps → pod-client → core, with pod-client ⟂ item-store.
//
// URI RECONCILIATION with `@onderling/pod-onboarding`'s `resourceUriFor`:
//   `createCircleStores({ dataSource, rootPrefix })` keys an item at
//       <rootPrefix><circleId>/items/<id>.json
//   and `resourceUriFor(circleId, itemId, {type})` (canonical layout) resolves
//       <podRoot>/group/<circleId>/<bucket>/<itemId>.
//   Setting `rootPrefix = <podRoot>/group/` (see `podGroupPrefix`) makes the store's physical keys BE the
//   canonical pod resource URIs — absolute `https://…` URLs `SolidPodSource` accepts (it refuses non-http
//   logical schemes on purpose). The generic `items` bucket is the default `containerFor` output, so a
//   list's items land exactly where the K share-grant resolver expects to grant against them.

import { SolidPodSource } from './SolidPodSource.js';
import { createSealedPodClient } from './sealing/SealedPodClient.js';
import { resolveCircleStorage } from './sealing/resolveCircleStorage.js';

/** Is this a "resource not on the pod yet" signal from SolidPodSource (or a compatible source)? */
function isNotFound(err) {
  return !!err && (err.code === 'NOT_FOUND' || err.status === 404);
}

/** Decode a pod read body (SolidPodSource returns Uint8Array `content`; a fake may return a string). */
function decodeBody(content) {
  if (content == null) return null;
  if (typeof content === 'string') return content;
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(content));
  return String(content);
}

/**
 * Present a `SolidPodSource` (rich `read`→{content:bytes}, `list`→{entries}) under the minimal PodClient
 * shape `createSealedPodClient` wraps: `read(uri)→{content:string}` (so `open()` sees the `fp1:` envelope
 * string, not raw bytes) + pass-through write/delete/list. Sealing is applied by the wrapper over THIS.
 */
function podClientAdapter(source) {
  return {
    async read(uri) {
      const res = await source.read(uri);
      return { ...res, content: decodeBody(res?.content) };
    },
    write: (uri, content, opts) => source.write(uri, content, opts),
    delete: (uri, opts) => source.delete(uri, opts),
    list: (uri, opts) => source.list(uri, opts),
  };
}

/**
 * Build a sealed, pod-backed `core.DataSource`.
 *
 * @param {object} opts
 * @param {object}   [opts.podSource]   a `SolidPodSource`-shaped source (read/write/delete/list). Defaults to
 *                                      `new SolidPodSource({ podUrl, fetch })`. Inject a fake for tests.
 * @param {Function} [opts.fetch]       authenticated fetch (e.g. `SolidVault.getAuthenticatedFetch()`), used
 *                                      to build the default `SolidPodSource`.
 * @param {string}   [opts.podUrl]      pod root, used to build the default `SolidPodSource`.
 * @param {{seal:Function,open:Function}|null} [opts.strategy]  an explicit sealing strategy (e.g. the circle
 *                                      control-agent's `sealingStrategy(privateKey)` result). When omitted it
 *                                      is derived from `posture` + keys below via `resolveCircleStorage`.
 * @param {'p0'|'p1'|'p2'|'p3'} [opts.posture]  storage posture (used only when `strategy` is not passed).
 * @param {string}   [opts.groupKey]    p2 group key (when deriving the strategy).
 * @param {string|string[]} [opts.recipients]  p3 recipients (when deriving the strategy).
 * @param {string}   [opts.privateKey]  p3 private key (when deriving the strategy).
 * @param {string}   [opts.contentType='application/json']  content-type written for each resource body.
 * @returns {{ read:Function, write:Function, delete:Function, list:Function, sealed:boolean }}
 */
export function createSealedPodDataSource(opts = {}) {
  const {
    podSource, fetch: fetchFn, podUrl,
    strategy, posture, groupKey, recipients, privateKey,
    contentType = 'application/json',
  } = opts;

  const source = podSource ?? new SolidPodSource({ podUrl, fetch: fetchFn });
  if (!source || typeof source.read !== 'function' || typeof source.write !== 'function') {
    throw new Error('createSealedPodDataSource: a SolidPodSource (or compatible read/write/delete/list) is required');
  }

  // A caller-supplied strategy wins; else derive one from the posture (null ⇒ plaintext / no client seal).
  const resolved = strategy !== undefined
    ? strategy
    : resolveCircleStorage({ posture, groupKey, recipients, privateKey });

  const adapter = podClientAdapter(source);
  // With a strategy, wrap for transparent seal-on-write / open-on-read; without one, use the plain adapter
  // (a p0/p1 posture stores plaintext on the pod — the host is trusted / the enclave seals instead).
  const client = resolved ? createSealedPodClient(adapter, resolved) : adapter;

  return {
    /** True iff bodies are sealed at rest (a strategy is active). */
    sealed: !!resolved,

    /** Read → the opened plaintext body (JSON string), or `null` when the resource isn't on the pod. */
    async read(uri) {
      try {
        const res = await client.read(uri);
        const body = res?.content;
        return body == null ? null : body;
      } catch (err) {
        if (isNotFound(err)) return null;   // DataSource.read: missing ⇒ null (not a throw)
        throw err;
      }
    },

    /** Write → seal the (string) body, then PUT it to the pod. */
    async write(uri, val) {
      await client.write(uri, String(val), { contentType });
    },

    /** Delete → remove the resource (a 404 is a no-op, per DataSource semantics). */
    async delete(uri) {
      try {
        await client.delete(uri);
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
    },

    /**
     * List → the resource URIs under `prefix` (a container URI). Maps the LDP container listing to the
     * flat `uri[]` the DataSource contract (and `CircleItemStore.list`) expects; an absent container is an
     * empty list, not a throw (parity with the memory/IDB sources — a not-yet-written circle has no items).
     */
    async list(prefix) {
      let res;
      try {
        res = await client.list(prefix);
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
      const entries = Array.isArray(res) ? res : (res?.entries ?? []);
      return entries
        .map((e) => (typeof e === 'string' ? e : e?.uri))
        .filter((u) => typeof u === 'string' && u.startsWith(prefix) && !u.endsWith('/'));
    },
  };
}

/**
 * The canonical `rootPrefix` for a pod-backed `createCircleStores`, so its keys BE the `resourceUriFor`
 * pod URIs: `<podRoot>/group/`. Pass the result as `rootPrefix` (item-store then appends `<circleId>/`).
 * @param {string} podRoot  the pod (or group-pod) root.
 * @returns {string} `<podRoot>/group/`
 */
export function podGroupPrefix(podRoot) {
  if (typeof podRoot !== 'string' || podRoot.length === 0) {
    throw new Error('podGroupPrefix: a podRoot is required');
  }
  const base = podRoot.endsWith('/') ? podRoot.slice(0, -1) : podRoot;
  return `${base}/group/`;
}
