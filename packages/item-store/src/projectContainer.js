/**
 * projectContainer — the recursive child-render PROJECTOR (cluster K · K2).
 *
 * The K1 finding made concrete: generalise `embedResolve` from "title preview" → a FULL recursive render of
 * a container + its contained children (each via its OWN type's render shape). One declaration → a nested
 * view: a list renders its tasks, a task renders its sub-tasks, an offer renders its list, … — heterogeneous,
 * arbitrarily deep, web≡mobile (the shell draws the returned tree; this is the pure data projection).
 *
 * `renderFor(item) → { label, rowActions?, … }` is INJECTED (the manifest provides each type's render shape —
 * its label field + per-row action op-ids — later; here it's pluggable + testable). Cycles are guarded
 * (`seen`), missing refs are skipped (survive-on-delete), and depth is bounded (`maxDepth`).
 *
 * @param {object} store                 a CircleItemStore (get) + containment (`childIdsOf` via the item's embeds)
 * @param {string} containerId
 * @param {object} [opts]
 * @param {(item:object)=>object} [opts.renderFor]  type→render shape ({label, rowActions?}); default = {label: text}
 * @param {number} [opts.maxDepth=6]
 * @returns {Promise<object|null>} `{ ...item, label, rowActions?, children:[…recursive] }` or null if absent
 */
import { childIdsOf } from './containment.js';

const defaultRender = (item) => ({ label: item?.text ?? item?.title ?? item?.id });

/**
 * Recursively project a container item and its contained children (via the item's `embeds` child
 * refs) into a nested render tree: `{ ...item, ...renderFor(item), children: [...] }`. Pure data
 * projection — cycles are broken with a seen-set, refs to missing/deleted items are skipped, and
 * recursion is bounded by `opts.maxDepth` (default 6). `renderFor` defaults to
 * `{ label: text ?? title ?? id }`. Resolves to `null` when the container itself is absent.
 */
export async function projectContainer(store, containerId, opts = {}) {
  const renderFor = typeof opts.renderFor === 'function' ? opts.renderFor : defaultRender;
  const maxDepth  = Number.isInteger(opts.maxDepth) ? opts.maxDepth : 6;

  async function project(id, depth, seen) {
    if (depth > maxDepth || seen.has(id)) return null;     // bound depth + break cycles
    const item = await store.get(id);
    if (!item) return null;                                 // ref to a deleted item → skip (survive-on-delete)
    const nextSeen = new Set(seen).add(id);
    const shape = renderFor(item) || {};
    const children = [];
    for (const childId of childIdsOf(item)) {
      const node = await project(childId, depth + 1, nextSeen);
      if (node) children.push(node);
    }
    return { ...item, ...shape, children };
  }

  return project(containerId, 0, new Set());
}
