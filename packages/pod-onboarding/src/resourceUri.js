/**
 * resourceUri — map a circle-scoped item (circleId + itemId) to its canonical pod-resource URI.
 *
 * This is the concrete storage-layout resolver the K read/write seam needs. `@onderling/pod-onboarding`
 * OWNS the pod storage layout (CLAUDE.md · conventions/storage-layout.md), so the `circle → pod URI`
 * derivation lives HERE, not in `@onderling/item-store` (which must stay pod-agnostic) and not baked into
 * `makeSharedRefPolicy` (which only takes an injected `resourceUriFor`).
 *
 * Canonical layout (storage-layout.md · "Canonical sub-container layout"): circle/circle-scoped data lives
 * under `group/<circleId>/<type>/`. A circle IS a circle in this model, so an item's resource is:
 *
 *     <pod>/group/<circleId>/<container>/<itemId>
 *
 * The `<container>` is the canonical item-TYPE bucket (`items/`, `tasks/`, `notes/`, `photos/`, …), keyed
 * by WHAT the object is — never by app (storage-layout.md · amended 2026-05-17). The default bucket is
 * `items`; a caller with a typed layout injects a `containerFor(type)` map. Path segments are URL-encoded
 * so a circle/item id can't break out of its container.
 *
 * This resolver is deliberately PURE + synchronous (no pod round-trip): the ACP grant target is a URI, and
 * the layout is convention, not a per-pod lookup. User-customised storage-mapping overrides (the
 * `private/storage-mapping` config) ride on top via `@onderling/pod-routing` — a resolver that must honour a
 * user override composes `PodRouting.resolve('group/<circleId>/<container>')` instead; see the note below.
 */

/**
 * Build a `resourceUriFor(circleId, itemId, { type }?) → uri` resolver for one pod.
 *
 * @param {object} opts
 * @param {string} opts.podUri                         the pod root (or group-pod root) that holds the circle's storage.
 * @param {(type?:string)=>string} [opts.containerFor] map an item's `type` → its canonical type-container name.
 *        Default: everything lands in the generic `items` bucket. Inject to route `task→tasks`, `note→notes`, etc.
 * @returns {(circleId:string, itemId:string, opts?:{type?:string})=>string}
 */
export function makeResourceUriResolver({ podUri, containerFor } = {}) {
  if (typeof podUri !== 'string' || podUri.length === 0) {
    throw Object.assign(
      new Error('makeResourceUriResolver: podUri is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const base = _stripTrailingSlash(podUri);
  const container = typeof containerFor === 'function' ? containerFor : () => 'items';

  return function resourceUriFor(circleId, itemId, { type } = {}) {
    if (typeof circleId !== 'string' || circleId.length === 0) {
      throw Object.assign(
        new Error('resourceUriFor: circleId is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof itemId !== 'string' || itemId.length === 0) {
      throw Object.assign(
        new Error('resourceUriFor: itemId is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const bucket = _encodeSegment(String(container(type) || 'items'));
    return `${base}/group/${_encodeSegment(circleId)}/${bucket}/${_encodeSegment(itemId)}`;
  };
}

/**
 * Adapt a `resourceUriFor(circleId, itemId, {type})` resolver to the shape `makeSharedRefPolicy` /
 * `makeShareGrantHook` want: `(ref) => uri`. A `shared-ref` carries `{ sourceCircle, sourceId, sourceType }`
 * — the source item's coordinates — so this reads those off the ref and delegates. Returns `null` for a
 * malformed ref (deny-by-default: no URI ⇒ the grant gate refuses).
 *
 * @param {(circleId:string, itemId:string, opts?:{type?:string})=>string} resolver
 * @returns {(ref:object)=>(string|null)}
 */
export function sharedRefResourceUri(resolver) {
  if (typeof resolver !== 'function') {
    throw Object.assign(
      new Error('sharedRefResourceUri: a resourceUriFor resolver is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  return (ref) => {
    if (!ref || !ref.sourceCircle || !ref.sourceId) return null;
    return resolver(ref.sourceCircle, ref.sourceId, { type: ref.sourceType });
  };
}

function _stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// Encode a single path segment. `encodeURIComponent` keeps ULIDs/plain ids intact and neutralises any
// `/`, `..`, or reserved char so an id can't traverse out of its `group/<circle>/<type>/` container.
function _encodeSegment(s) {
  return encodeURIComponent(String(s));
}
