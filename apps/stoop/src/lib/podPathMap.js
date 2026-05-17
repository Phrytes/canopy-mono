/**
 * podPathMap — Stoop's `mem://` logical-key ↔ canonical
 * storage-function classifier (Phase 2 of the pod-storage routing
 * work; spec = the 13-row table in
 * `Project Files/TODO-GENERAL.md` 🔴 "Stoop pod-backed storage").
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

/** Percent-encode each path segment (keep `/` separators). */
function encTail(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}
function decTail(p) {
  return p.split('/').map(decodeURIComponent).join('/');
}

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
    if (sub === 'item-attachments') return 'mem://stoop/items/'          + decoded;
  }
  return null;
}

export const _internal = { encTail, decTail, RULES };
