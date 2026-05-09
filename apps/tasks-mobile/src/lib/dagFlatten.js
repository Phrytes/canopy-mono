/**
 * dagFlatten — pure-fn helper that turns a getDagTree result into a
 * flat list of `{node, depth}` rows for FlatList rendering.
 *
 * Phase 41.6 (2026-05-09).
 *
 * The substrate's `getDagTree` returns a recursive `{task, children:
 * [{task, children: [...]}]}` shape. The flat-list renderer prefers
 * a row-per-node array; this helper walks the tree depth-first and
 * emits indented rows.
 */

/**
 * @param {object|null} root   getDagTree response — either the root
 *   node `{task, children}` directly or `{tree: {task, children}}`.
 * @returns {Array<{task: object, depth: number}>}
 */
export function flattenDagTree(root) {
  if (!root) return [];
  const start = root?.tree ?? root;
  if (!start || typeof start !== 'object') return [];
  const out = [];
  _walk(start, 0, out);
  return out;
}

function _walk(node, depth, out) {
  if (!node || typeof node !== 'object') return;
  if (node.task) out.push({ task: node.task, depth });
  if (Array.isArray(node.children)) {
    for (const c of node.children) _walk(c, depth + 1, out);
  }
}

export const _internal = { _walk };
