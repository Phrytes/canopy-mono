/**
 * podPathMap — Stoop's `mem://` logical-key ↔ canonical
 * storage-function classifier (Phase 2 of the pod-storage routing
 * work).
 *
 * PURE + reversible. No pod-routing / identity / network here — the
 * attach-time glue (Phase 2.4) composes `classify` + the bundle's
 * `podRouting.resolve()` into the `CachingDataSource` `innerKeyMap`.
 *
 * Design: a logical `mem://` key maps to `{ storageFn, tail }` where
 * `storageFn` is a canonical (type/domain-keyed, app-agnostic)
 * pod-routing storage-function and `tail` is the resource path
 * within it (each segment percent-encoded so `:`-bearing ids like
 * `webid:local:<peer>` are pod-safe).  The (family ↔ logical-prefix)
 * pairing is a bijection so `unclassify` round-trips.  `crewId` is
 * orthogonal runtime context (injected into `group/<crewId>/…`); the
 * logical key never encodes it, so `unclassify` drops it.
 *
 * Returns `null` for keys that are intentionally NOT type-routed:
 *   - `mem://stoop/settings/…` → the locked `cross-app-settings.md`
 *     convention owns these (D5; deliberate app-namespaced exception).
 *   - own-profile → `sharing/profile-public` split needs the active
 *     identity → deferred to Phase 3 (members route uniformly here).
 *   - anything unrecognised → caller skips it safely.
 */

// `mem://` logical keys are ALREADY pod-path-safe by upstream
// construction: MemberMapCache + ContactBook `encodeURIComponent`
// their ids (so `webid:local:<peer>` arrives as
// `webid%3Alocal%3A<peer>`), and items use URL-safe ULIDs. The
// classifier must therefore pass segments through **verbatim** — an
// extra encode double-encoded `%3A`→`%253A` on real roster keys
// (device pass, 2026-05-17). Keeping these as identity makes the
// logical↔pod mapping an exact, reversible transform of *only* the
// prefix; segment encoding stays owned by the upstream writers.
function encTail(p) { return p; }
function decTail(p) { return p; }

// Ordered rules. `prefix` = logical prefix; `family` = a stable,
// injective key that `unclassify` maps back to `prefix`; `fn(crewId)`
// = the pod-routing storage-function. `crew` rules require a crewId.
const RULES = [
  { family: 'g-items',   prefix: 'mem://neighborhood/items/',   crew: true,
    fn: (c) => `group/${c}/items` },
  { family: 'g-members', prefix: 'mem://neighborhood/members/', crew: true,
    fn: (c) => `group/${c}/members` },
  { family: 'g-gov',     prefix: 'mem://neighborhood/groups/',  crew: true,
    fn: (c) => `group/${c}/governance` },
  { family: 'g-audit',   prefix: 'mem://neighborhood/audit/',   crew: true,
    fn: (c) => `group/${c}/audit` },
  // Attachments live under `mem://stoop/items/<id>/attachments/…`;
  // distinct family so the round-trip stays bijective vs g-items.
  { family: 'g-att',     prefix: 'mem://stoop/items/',          crew: true,
    fn: (c) => `group/${c}/item-attachments` },
  { family: 's-threads', prefix: 'mem://stoop/threads/',        crew: false,
    fn: () => 'sharing/threads' },
  // Private app-state (non-shareable plumbing). Tail keeps the
  // `stoop/…` sub-key under `private/state` (D4 — app sub-key OK).
  { family: 'priv',      prefix: 'mem://stoop/reveals.json',           crew: false, exact: true, fn: () => 'private/state' },
  { family: 'priv',      prefix: 'mem://stoop/push-subscriptions.json', crew: false, exact: true, fn: () => 'private/state' },
  { family: 'priv',      prefix: 'mem://stoop/interest-profile.json',  crew: false, exact: true, fn: () => 'private/state' },
  { family: 'priv',      prefix: 'mem://stoop/lists/',                 crew: false, fn: () => 'private/state' },
  { family: 'priv',      prefix: 'mem://stoop/avatars/',               crew: false, fn: () => 'private/state' },
];

/**
 * @param {string} memPath  a `mem://…` logical key
 * @param {{crewId?: string}} [ctx]
 * @returns {{storageFn: string, tail: string} | null}
 */
export function classify(memPath, { crewId } = {}) {
  if (typeof memPath !== 'string' || !memPath.startsWith('mem://')) return null;
  // Out of scope (owned by cross-app-settings.md).
  if (memPath.startsWith('mem://stoop/settings')) return null;

  for (const r of RULES) {
    const hit = r.exact ? memPath === r.prefix : memPath.startsWith(r.prefix);
    if (!hit) continue;
    if (r.crew && (typeof crewId !== 'string' || crewId.length === 0)) {
      // crew-scoped key but no active crew → caller skips (Phase 2.4
      // only routes when a crew + pod are present).
      return null;
    }
    const rel = r.exact ? '' : memPath.slice(r.prefix.length);
    const tail = r.family === 'priv'
      // private/state keeps the full `stoop/…` sub-path verbatim.
      ? encTail(memPath.slice('mem://'.length))
      : encTail(rel);
    return { storageFn: r.fn(crewId), tail };
  }
  return null;
}

/**
 * Inverse of {@link classify}: `(storageFn, tail) → mem:// key`.
 * `crewId` in a `group/<crewId>/…` storageFn is parsed out and
 * discarded (the logical key never encodes it).
 *
 * @param {string} storageFn
 * @param {string} tail
 * @returns {string | null}
 */
export function unclassify(storageFn, tail) {
  if (typeof storageFn !== 'string' || typeof tail !== 'string') return null;

  if (storageFn === 'private/state') {
    // tail === encoded(`stoop/…`) → logical = `mem://` + decoded tail.
    return 'mem://' + decTail(tail);
  }
  if (storageFn === 'sharing/threads') {
    return 'mem://stoop/threads/' + decTail(tail);
  }
  if (storageFn.startsWith('group/')) {
    const rest = storageFn.slice('group/'.length);
    const sub  = rest.slice(rest.indexOf('/') + 1); // drop <crewId>/
    const decoded = decTail(tail);
    if (sub === 'items')            return 'mem://neighborhood/items/'   + decoded;
    if (sub === 'members')          return 'mem://neighborhood/members/' + decoded;
    if (sub === 'governance')       return 'mem://neighborhood/groups/'  + decoded;
    if (sub === 'audit')            return 'mem://neighborhood/audit/'   + decoded;
    if (sub === 'item-attachments') return 'mem://stoop/items/'          + decoded;
  }
  return null;
}

/**
 * Phase 3.3 — inverse of the attach-time `toInner`
 * (`classify` + `podRouting.resolve` + join): given a concrete pod /
 * pseudo-pod URI and the routing context, recover the `mem://`
 * logical key. This is the `CachingDataSource.fromInner` that
 * `pullFromInner` needs to re-key pod read-backs (and the basis of
 * the cross-app type-index read path).
 *
 * Pure — the caller injects `resolve` (= `podRouting.resolve`).
 * Tries every distinct storage-function (crew ones need `crewId`),
 * longest matching base wins, then `unclassify`. Returns null when
 * the URI is under no known base (caller falls back to identity).
 *
 * @param {object} a
 * @param {(storageFn:string, vars?:object)=>string|null} a.resolve
 * @param {string} [a.crewId]
 * @param {string} a.podUri
 * @param {object} [a.vars]
 * @returns {string|null}
 */
export function reverseResolve({ resolve, crewId, podUri, vars } = {}) {
  if (typeof resolve !== 'function' || typeof podUri !== 'string' || !podUri) {
    return null;
  }
  const fns = new Set();
  for (const r of RULES) {
    if (r.crew) { if (crewId) fns.add(r.fn(crewId)); }
    else fns.add(r.fn());
  }
  let best = null;
  for (const storageFn of fns) {
    let base;
    try { base = resolve(storageFn, vars || {}); } catch { base = null; }
    if (typeof base !== 'string' || base.length === 0) continue;
    // `toInner` did: base.endsWith('/') ? base+tail : base+'/'+tail.
    let rem = null;
    if (base.endsWith('/')) {
      if (podUri.startsWith(base)) rem = podUri.slice(base.length);
    } else if (podUri === base) {
      rem = '';
    } else if (podUri.startsWith(base + '/')) {
      rem = podUri.slice(base.length + 1);
    }
    if (rem === null) continue;
    if (!best || base.length > best.baseLen) {
      best = { storageFn, tail: rem, baseLen: base.length };
    }
  }
  if (!best) return null;
  return unclassify(best.storageFn, best.tail);
}

export const _internal = { encTail, decTail, RULES };
