/**
 * Curation compare + render (feedback-extension P3).
 *
 * The "before/after curation" view central to feedback (original message →
 * cleaned/curated version) reuses the SAME compute as folio's file-merge:
 * `@canopy/sync-engine` `objectDiff` (a pure, self-contained 3-way diff). One
 * compute, two LOOKS — folio renders the diff as a file-merge UI;
 * `renderCuration` renders it as a before/after curation view.
 *
 * `objectDiff` is imported by relative path because it's a leaf module with no
 * imports of its own — no cross-package dependency plumbing needed.
 */

import { objectDiff, deepEqual } from '@canopy/sync-engine/objectDiff';

const isObj = (v) => v != null && typeof v === 'object';

/**
 * Compare two content versions for curation. For objects, reuses `objectDiff`
 * (base = `before`, so `toMerge` is exactly the before→after changes). For
 * strings/primitives, a whole-value before/after (segment-level text diff is a
 * later enhancement).
 *
 * @param {*} before   the original (e.g. the raw message)
 * @param {*} after    the curated/cleaned version
 * @param {*} [base]   optional 3-way ancestor; defaults to `before`
 * @returns {{ before:*, after:*, changed:boolean, diff: object|null }}
 */
export function compareForCuration(before, after, base = null) {
  const changed = !deepEqual(before, after);
  const diff = (isObj(before) && isObj(after)) ? objectDiff(before, after, base ?? before) : null;
  return { before, after, changed, diff };
}

/**
 * Render a `compareForCuration` result as a before/after curation VIEW MODEL
 * (structural — the consuming surface adds labels via `t()`). Distinct "look"
 * from folio's file-merge renderer, same underlying compute.
 *
 * @param {{ before:*, after:*, changed:boolean, diff: object|null }} comparison
 * @returns {{ kind:'curation', changed:boolean, sides:{before:*,after:*}, changedPaths:string[] }}
 */
export function renderCuration(comparison) {
  const { before, after, changed, diff } = comparison ?? {};
  const changedPaths = diff
    ? diff.toMerge.map((m) => (Array.isArray(m.path) ? m.path.join('.') : String(m.path)))
    : (changed ? ['(content)'] : []);
  return {
    kind: 'curation',
    changed: !!changed,
    sides: { before, after },
    changedPaths,
  };
}
