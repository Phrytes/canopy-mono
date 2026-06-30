/**
 * containment — the data half of cluster K (K2) over a `CircleItemStore`-shaped store.
 *
 * Per the K1 spike, CONTAINMENT IS A REF + A BACK-REF, never a copy or an access grant:
 *   - parent gains an embed edge   `embeds: [{ type, ref:<childId>, rel:'contains' }]`
 *   - child  gains a back-reference `containedBy: [<parentId>, …]`  (cheap orphan-detect + multi-parent)
 *
 * It reuses the existing `embeds:[{type,ref}]` shape (additive `rel` discriminator — `'contains'` vs the
 * default `'refers'`, so legacy embeds stay plain references). Children are heterogeneous and each is
 * validated independently by the store on write (recursive validation = per-item validation).
 *
 * Cascade policy (Frits 2026-06-30): **SURVIVE** — deleting a container does NOT delete its children; it
 * detaches them (drops the back-ref), so they live on as "loose items" listable by their owner on request.
 *
 * Same-circle = INTRA-store (refs are plain child ids; resolve via `store.get`). Cross-circle links use a
 * full URI ref + the embedResolve/getItemTree bridge — out of scope here (this module is one circle's store).
 *
 * Functions over any store exposing `get(id)`/`put(item)`/`delete(id)`/`list()` (CircleItemStore).
 */

const REL_CONTAINS = 'contains';

const asArray = (v) => (Array.isArray(v) ? v : []);
const dedupe  = (arr) => [...new Set(arr)];

/** Does this embed edge express containment? */
function isContainsEdge(e, childId) {
  return e && e.rel === REL_CONTAINS && e.ref === childId;
}

/**
 * Make `parentId` contain `childId` (idempotent; supports multi-parent). Adds the parent→child `contains`
 * edge + the child→parent back-ref. Returns `{ parent, child }` (the updated items).
 */
export async function contain(store, parentId, childId) {
  if (parentId === childId) throw new Error('containment.contain: an item cannot contain itself');
  const parent = await store.get(parentId);
  const child  = await store.get(childId);
  if (!parent) throw new Error(`containment.contain: parent "${parentId}" not found`);
  if (!child)  throw new Error(`containment.contain: child "${childId}" not found`);

  const edges = asArray(parent.embeds);
  if (!edges.some((e) => isContainsEdge(e, childId))) {
    parent.embeds = [...edges, { type: child.type, ref: childId, rel: REL_CONTAINS }];
    await store.put(parent);
  }
  const parents = asArray(child.containedBy);
  if (!parents.includes(parentId)) {
    child.containedBy = dedupe([...parents, parentId]);
    child.wasContained = true;             // distinguishes a true orphan (lost a parent) from a never-nested item
    await store.put(child);
  }
  return { parent, child };
}

/** Remove the containment edge between `parentId` and `childId` (both sides). Idempotent. */
export async function uncontain(store, parentId, childId) {
  const parent = await store.get(parentId);
  if (parent) {
    const edges = asArray(parent.embeds).filter((e) => !isContainsEdge(e, childId));
    if (edges.length !== asArray(parent.embeds).length) { parent.embeds = edges; await store.put(parent); }
  }
  const child = await store.get(childId);
  if (child) {
    const parents = asArray(child.containedBy).filter((p) => p !== parentId);
    if (parents.length !== asArray(child.containedBy).length) { child.containedBy = parents; await store.put(child); }
  }
}

/** The child ids `parentId` directly contains (in declaration order). */
export function childIdsOf(parent) {
  return asArray(parent && parent.embeds).filter((e) => e && e.rel === REL_CONTAINS && e.ref).map((e) => e.ref);
}

/** Resolve `parentId`'s direct children to items (skips refs that no longer exist — survive-on-delete). */
export async function listChildren(store, parentId) {
  const parent = await store.get(parentId);
  if (!parent) return [];
  const out = [];
  for (const id of childIdsOf(parent)) {
    const c = await store.get(id);
    if (c) out.push(c);
  }
  return out;
}

/** The parent ids that currently contain `childId` (the back-ref). */
export async function parentsOf(store, childId) {
  const child = await store.get(childId);
  return child ? asArray(child.containedBy) : [];
}

/**
 * Delete a container but let its children SURVIVE (Frits's cascade choice). Detaches each child (drops the
 * back-ref to this parent); a child left with no parents becomes "loose" (listable via `listLoose`). Returns
 * the ids of the children that are now orphaned (lost their last parent).
 */
export async function deleteContainer(store, parentId) {
  const parent = await store.get(parentId);
  const orphaned = [];
  if (parent) {
    for (const id of childIdsOf(parent)) {
      const child = await store.get(id);
      if (!child) continue;
      const parents = asArray(child.containedBy).filter((p) => p !== parentId);
      child.containedBy = parents;
      await store.put(child);
      if (parents.length === 0) orphaned.push(id);
    }
  }
  await store.delete(parentId);
  return orphaned;
}

/**
 * "Loose items" for an owner — items they created that sit in NO live container (`containedBy` empty).
 * `opts.orphansOnly` narrows to TRUE orphans (items that once had a parent — `wasContained` — and lost it),
 * excluding intentionally top-level items (a standalone offer/list). Matches Frits's "list orphans on request".
 */
export async function listLoose(store, ownerId, opts = {}) {
  const all = await store.list();
  return all.filter((it) => it
    && it.createdBy === ownerId
    && asArray(it.containedBy).length === 0
    && (!opts.orphansOnly || it.wasContained === true));
}
