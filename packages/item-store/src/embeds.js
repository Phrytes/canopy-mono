/**
 * embeds — cross-app reference traversal.
 *
 * Every item type may carry an `embeds: [{type, ref}, ...]` field —
 * standardised by `@canopy/item-types`. Refs are URIs (pseudo-pod
 * or pod-attached). Apps walk the graph at render time to surface
 * the embedded chips inline.
 *
 * `treeOf(rootId, opts)` walks BOTH `dependencies` (subtask graph)
 * AND `embeds` (cross-type refs). Refs outside the local store are
 * resolved via the caller-supplied `resolveExternalRef` callback;
 * permission failures or missing refs surface as placeholder nodes
 * rather than throwing.
 *
 * Standardisation Phase 52.6.1.
 */

/**
 * @typedef {object} TreeNode
 * @property {string} id                 — local item id, or `null` for placeholders
 * @property {string} [type]
 * @property {object} [item]             — full item record (when resolved)
 * @property {string} [ref]              — original URI (only on embed nodes)
 * @property {'local'|'external'|'placeholder'} source
 * @property {string} [reason]           — populated for placeholders (e.g. 'NOT_FOUND', 'PERMISSION_DENIED')
 * @property {TreeNode[]} subtasks       — from `dependencies`
 * @property {TreeNode[]} embeds         — from `embeds[]`
 */

/**
 * Walk the dependencies + embeds graph rooted at `rootId`.
 *
 * @param {object} args
 * @param {string} args.rootId
 * @param {(id: string) => Promise<object|null>} args.getItem
 *   Read an item by id from the local store. Substrate normally
 *   passes a closure over its DataSource.
 * @param {(ref: string) => Promise<{item?: object} | null>} [args.resolveExternalRef]
 *   Optional: fetch an item by external URI ref. May throw on
 *   permission failure — the walk yields a placeholder.
 * @param {number} [args.maxDepth=8]  — guards against accidental cycles
 *
 * @returns {Promise<TreeNode>}
 */
export async function treeOf({
  rootId,
  getItem,
  resolveExternalRef,
  maxDepth = 8,
} = {}) {
  if (typeof rootId !== 'string' || rootId.length === 0) {
    throw Object.assign(
      new Error('treeOf: rootId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof getItem !== 'function') {
    throw Object.assign(
      new Error('treeOf: getItem is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  const seenLocal    = new Set();
  const seenExternal = new Set();

  async function walkLocal(id, depth) {
    if (seenLocal.has(id) || depth > maxDepth) {
      return _placeholder({ id, source: 'placeholder', reason: 'CYCLE_OR_DEPTH' });
    }
    seenLocal.add(id);
    const item = await getItem(id);
    if (!item) {
      return _placeholder({ id, source: 'placeholder', reason: 'NOT_FOUND' });
    }
    const subtasks = [];
    for (const depId of item.dependencies ?? []) {
      subtasks.push(await walkLocal(depId, depth + 1));
    }
    const embeds = [];
    for (const e of item.embeds ?? []) {
      embeds.push(await walkEmbed(e, depth + 1));
    }
    return {
      id,
      type: item.type,
      item,
      source: 'local',
      subtasks,
      embeds,
    };
  }

  async function walkEmbed(embed, depth) {
    if (!embed || typeof embed !== 'object') {
      return _placeholder({ id: null, source: 'placeholder', reason: 'BAD_EMBED' });
    }
    const { type, ref } = embed;
    if (typeof ref !== 'string' || ref.length === 0) {
      return _placeholder({ id: null, type, source: 'placeholder', reason: 'BAD_EMBED' });
    }
    if (seenExternal.has(ref)) {
      return _placeholder({ id: null, type, ref, source: 'placeholder', reason: 'CYCLE_OR_DEPTH' });
    }
    if (depth > maxDepth) {
      return _placeholder({ id: null, type, ref, source: 'placeholder', reason: 'CYCLE_OR_DEPTH' });
    }
    seenExternal.add(ref);
    if (typeof resolveExternalRef !== 'function') {
      return _placeholder({ id: null, type, ref, source: 'placeholder', reason: 'NO_RESOLVER' });
    }
    let resolved;
    try {
      resolved = await resolveExternalRef(ref);
    } catch (err) {
      return _placeholder({
        id:     null,
        type,
        ref,
        source: 'placeholder',
        reason: err?.code ?? 'RESOLVE_FAILED',
      });
    }
    if (!resolved || !resolved.item) {
      return _placeholder({ id: null, type, ref, source: 'placeholder', reason: 'NOT_FOUND' });
    }
    return {
      id:     resolved.item.id ?? null,
      type:   resolved.item.type ?? type,
      item:   resolved.item,
      ref,
      source: 'external',
      subtasks: [],
      embeds:   [],
    };
  }

  return walkLocal(rootId, 0);
}

function _placeholder({ id, type, ref, source, reason }) {
  return {
    id,
    ...(type ? { type } : {}),
    ...(ref  ? { ref }  : {}),
    source,
    reason,
    subtasks: [],
    embeds:   [],
  };
}
