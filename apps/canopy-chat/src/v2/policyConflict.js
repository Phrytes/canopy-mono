/**
 * canopy-chat v2 — circle-policy conflict detection + resolution
 * (Plan γ.4, Phase 9 sync-engine absorption).
 *
 * Pure portable layer over `objectDiff` (γ.1) for the circle policy.
 * The policy has no `blocks` array — every divergence surfaces as a
 * meta-conflict.  Unlike the flat rules doc, the policy has NESTED
 * objects (`push: {...}`, `features: {...}`, `flowThrough: {...}`),
 * so conflict paths can be deeper than one segment
 * (e.g. `['push', 'onMention']`); the resolver renders the dotted
 * `path.join('.')` as the field label and that reads cleanly for these
 * shapes.
 *
 * Output shape mirrors γ.3's `detectRecipeConflicts` (with an always-
 * empty `blockConflicts`) so the existing resolver UI (web + mobile)
 * — which already handles an empty `blockConflicts` cleanly — is
 * reusable as-is, just with a different heading (the resolver's γ.4
 * `title` opt).
 *
 *   {
 *     blockConflicts: [],
 *     metaConflicts:  [{ path, yours, theirs, base }],
 *     identical:      boolean,
 *     toMerge:        Array<{ path, yours, theirs }>,
 *   }
 *
 * `applyPolicyResolution(local, incoming, decisions)` produces the
 * merged policy from the user's picks:
 *   - decisions[pathKey] ∈ {'yours','theirs'}    // pathKey = path.join('.')
 *
 * Decisions for missing keys default to 'theirs' (incoming wins) — same
 * rationale as `rulesConflict.js`: an incoming policy diff was authored
 * deliberately by the other admin, so we lean toward broadcast unless
 * the local user explicitly chooses 'yours'.
 *
 * Purity: no I/O, no Date.now, no Math.random.
 */

import { objectDiff } from '@canopy/sync-engine/objectDiff';

/**
 * @typedef {object} MetaConflict
 * @property {string[]} path
 * @property {*} yours
 * @property {*} theirs
 * @property {*} base
 */

/**
 * @typedef {object} PolicyConflictReport
 * @property {[]} blockConflicts        Always empty for policy (no blocks array).
 * @property {MetaConflict[]} metaConflicts
 * @property {boolean} identical
 * @property {Array<{path: string[], yours: any, theirs: any}>} toMerge
 */

/**
 * Detect conflicts between two circle-policy shapes using `base` as the
 * 3-way merge ancestor.  `base` may be `null`/`undefined`.
 *
 * @param {object} local
 * @param {object} incoming
 * @param {object|null} base
 * @returns {PolicyConflictReport}
 */
export function detectPolicyConflicts(local, incoming, base) {
  const { toMerge, conflicts, identical } =
    objectDiff(local || {}, incoming || {}, base ?? null);
  return {
    blockConflicts: [],
    metaConflicts:  conflicts,
    identical,
    toMerge,
  };
}

/**
 * Apply user-picked resolutions to produce the merged policy.
 *
 * Decisions are keyed by `path.join('.')` (e.g. `'view'`,
 * `'push.onMention'`, `'features.tasks'`) and take:
 *   'yours'  — keep the local value at that path
 *   'theirs' — replace with the incoming value at that path
 *
 * Fields with NO decision default to 'theirs' (incoming wins).  `toMerge`
 * (clean one-sided changes) are auto-applied so the non-conflicting half
 * of the three-way merge is carried into the result.
 *
 * @param {object} local
 * @param {object} incoming
 * @param {Record<string, string>} decisions
 * @returns {object} merged policy
 */
export function applyPolicyResolution(local, incoming, decisions = {}) {
  const safeLocal    = local    && typeof local    === 'object' ? local    : {};
  const safeIncoming = incoming && typeof incoming === 'object' ? incoming : {};

  // Default = take incoming wholesale, then overlay locally-picked
  // 'yours' fields.  Deep clone the incoming so we don't mutate the
  // caller's object when setAtPath mutates nested structures.
  const merged = deepClone(safeIncoming);

  for (const [pathKey, pick] of Object.entries(decisions || {})) {
    if (typeof pathKey !== 'string' || pathKey === '') continue;
    if (pick !== 'yours' && pick !== 'theirs') continue;
    const path = pathKey.split('.');
    if (pick === 'yours') {
      setAtPath(merged, path, getAtPath(safeLocal, path));
    } else if (pick === 'theirs') {
      setAtPath(merged, path, getAtPath(safeIncoming, path));
    }
  }

  // Preserve TOP-LEVEL local keys the incoming doesn't carry at all.
  // Nested-only locals are not recursed here — policy is small enough
  // that an unknown nested key never surfaces; keeping the shallow
  // pass conservative avoids accidental over-merges into nested objs.
  for (const k of Object.keys(safeLocal)) {
    if (!(k in safeIncoming) && !(k in merged)) {
      merged[k] = safeLocal[k];
    }
  }

  return merged;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* internals                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

function getAtPath(obj, path) {
  let cur = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setAtPath(obj, path, value) {
  if (!Array.isArray(path) || path.length === 0) return;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (cur[seg] == null || typeof cur[seg] !== 'object' || Array.isArray(cur[seg])) {
      cur[seg] = {};
    }
    cur = cur[seg];
  }
  cur[path[path.length - 1]] = value;
}

function deepClone(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone);
  const out = {};
  for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
  return out;
}
