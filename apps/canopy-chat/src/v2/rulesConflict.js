/**
 * canopy-chat v2 — rules-doc conflict detection + resolution
 * (Plan γ.4, Phase 9 sync-engine absorption).
 *
 * Pure portable layer over `objectDiff` (γ.1) for the rules document.
 * Unlike the recipe shape, rules are a FLAT keyed JSON blob (purpose /
 * admins / agreements / conflict / admission / leaving / responsibility
 * — every field a string) with NO `blocks` array.  That means every
 * `objectDiff` conflict surfaces as a meta-conflict; `blockConflicts`
 * is always empty.
 *
 * The output shape matches γ.3's `detectRecipeConflicts` so the existing
 * resolver UI (web + mobile) — which already gracefully handles an
 * empty `blockConflicts` — is reusable as-is with only a different
 * heading (via the resolver's γ.4 `title` opt).
 *
 *   {
 *     blockConflicts: [],                       // always empty
 *     metaConflicts:  [{ path, yours, theirs, base }],
 *     identical:      boolean,                  // true ⇒ no UI needed
 *   }
 *
 * `applyRulesResolution(local, incoming, decisions)` produces the merged
 * rules doc from the user's picks:
 *   - decisions[pathKey] ∈ {'yours','theirs'}     // pathKey is path.join('.')
 *
 * Decisions for missing keys default to 'theirs' (incoming wins) — this
 * matches the v2 design intent: when an incoming doc arrives and the user
 * doesn't explicitly stake a claim on a divergent field, we lean toward
 * the broadcast version (the doc was authored deliberately by the other
 * admin).  Recipes use the opposite default ('yours') because blocks
 * carry richer local state; the flat rules fields have no comparable
 * editing context that would make a local pick more careful.
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
 * @typedef {object} RulesConflictReport
 * @property {[]} blockConflicts         Always empty for rules (no blocks array).
 * @property {MetaConflict[]} metaConflicts
 * @property {boolean} identical
 * @property {Array<{path: string[], yours: any, theirs: any}>} toMerge
 */

/**
 * Detect conflicts between two rules-doc shapes using `base` as the
 * 3-way merge ancestor.  `base` may be `null`/`undefined` when no
 * version was captured yet (e.g. first edit on a fresh circle).
 *
 * @param {object} local      rules doc { purpose, admins, agreements, ... }
 * @param {object} incoming   rules doc (same shape)
 * @param {object|null} base  last captured version, or null when unknown.
 * @returns {RulesConflictReport}
 */
export function detectRulesConflicts(local, incoming, base) {
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
 * Apply user-picked resolutions to produce the merged rules doc.
 *
 * Decisions are keyed by `path.join('.')` (e.g. `'purpose'`, or for
 * future nested shapes `'meta.title'`) and take:
 *   'yours'  — keep the local value
 *   'theirs' — replace with the incoming value
 *
 * Fields with NO decision default to 'theirs' (incoming wins) — see
 * the module docstring for the rationale.  `toMerge` (clean one-sided
 * changes) are auto-applied so the non-conflicting half of the
 * three-way merge is carried into the result.
 *
 * @param {object} local
 * @param {object} incoming
 * @param {Record<string, string>} decisions
 * @returns {object} merged rules doc
 */
export function applyRulesResolution(local, incoming, decisions = {}) {
  const safeLocal    = local    && typeof local    === 'object' ? local    : {};
  const safeIncoming = incoming && typeof incoming === 'object' ? incoming : {};

  // Start from the incoming doc (so default = 'theirs') and overlay
  // local values for fields the user explicitly picked 'yours'.  Then
  // re-apply local-only keys NOT present in incoming (lossless).
  const merged = { ...safeIncoming };

  // Pick local for every field the user marked 'yours'.
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

  // Preserve local keys that the incoming doc doesn't carry at all
  // (truly local additions — without this, a one-sided local field
  // would silently disappear when merged).
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
