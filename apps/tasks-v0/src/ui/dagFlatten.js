/**
 * dagFlatten — pure-fn helper that turns a `getDagTree` skill
 * result into a flat list of `{task, depth}` rows for renderers.
 *
 * Phase 41.6 (2026-05-09).
 *
 * Lifted 2026-05-10 from `apps/tasks-mobile/src/lib/dagFlatten.js`
 * into `apps/tasks-v0/src/ui/` per the
 * "Shared UI-glue helpers between platform shells" rule
 * (`Project Files/conventions/architectural-layering.md`).
 *
 * Both shells consume from here:
 *   - `apps/tasks-mobile/src/screens/DagScreen.jsx`     (RN)
 *   - `apps/tasks-v0/web/dag.html` + handlers           (desktop, when wired)
 *
 * Pure-fn only — must not import from `react-native`, DOM globals,
 * or any platform module.
 *
 * `getDagTree` returns one of three shapes:
 *
 *   1. Bare node:        `{task, children: [...]}`
 *   2. Single-root env:  `{tree: {task, children: [...]}}`         (rootId given)
 *   3. All-roots env:    `{trees: [{task, children: [...]}, ...]}` (no rootId)
 *
 * `flattenDagTree(input)` accepts any of the three and emits a
 * depth-first array of `{task, depth}` rows.
 */

/**
 * @param {object|null} input  getDagTree response — bare node, `{tree}`, or `{trees}`
 * @returns {Array<{task: object, depth: number}>}
 */
export function flattenDagTree(input) {
  if (!input) return [];
  // 41.18 follow-up — `{trees: [...]}` is the no-rootId branch
  // (DagScreen mounted from MainMenu with no `id` lands here).
  if (Array.isArray(input?.trees)) {
    const out = [];
    for (const t of input.trees) _walk(t, 0, out);
    return out;
  }
  const start = input?.tree ?? input;
  if (!start || typeof start !== 'object') return [];
  const out = [];
  _walk(start, 0, out);
  return out;
}

function _walk(node, depth, out) {
  if (!node || typeof node !== 'object') return;
  // The substrate's `treeOf` (apps/tasks-v0/src/dag-tree.js) emits
  // nodes with `{id, item, children}` — note `item`, not `task`.
  // Older test fixtures used `{task, children}`; accept both, but
  // normalise the output row to `{task, depth}` so renderers don't
  // need a switch.
  const t = node.task ?? node.item ?? null;
  if (t) out.push({ task: t, depth });
  if (Array.isArray(node.children)) {
    for (const c of node.children) _walk(c, depth + 1, out);
  }
}

export const _internal = { _walk };
