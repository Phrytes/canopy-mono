/**
 * circleLists — the composable LISTS feature over the K2 substrate (cluster K · K2, the container UI).
 *
 * A `list` CONTAINER whose entries are `list-item` CHILDREN (K2 containment), and — since the child type is
 * now POLICY-DRIVEN (`buildAcceptsPolicy` + `resolveAddInContainer`, not a hardcoded `list`→`list-item`) — a
 * `list-item` is itself a container that accepts SUB-items: the offer→list→tasks→subtasks nesting made real.
 * One per-circle `CircleItemStore`; the panel (web `openListsPanel` / RN `CircleListsScreen`) renders a list
 * via `projectContainer` + the per-platform container card. PERSISTENT (web IDB / mobile AsyncStorage); the
 * `accepts` policy is the SURFACING contract other apps extend (a notes app could declare "a list accepts
 * notes" without this module knowing). web≡mobile: both shells reuse this module.
 */
import {
  createCircleStores, memoryDataSource, addChildTo, projectContainer,
  buildAcceptsPolicy, resolveAddInContainer,
} from '@canopy/item-store';
import { createRegistry, registerCanonicalTypes } from '@canopy/item-types';

const LIST_SCHEMA = Object.freeze({
  type: 'object', properties: { type: { const: 'list' }, text: { type: 'string', minLength: 1 } }, required: ['type', 'text'],
});
const ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: { type: { const: 'list-item' }, text: { type: 'string', minLength: 1 }, completedAt: { type: ['number', 'null'] } },
  required: ['type', 'text'],
});

/**
 * The lists feature's manifest-style `accepts` declaration (cluster K · K2 surfacing): a `list` CONTAINS
 * `list-item`s; a `list-item` CONTAINS sub-items (the composable nesting). `buildAcceptsPolicy` merges this
 * with any other apps' declarations, so what a container accepts is EXTENSIBLE, not baked into this module.
 */
export const LISTS_ACCEPTS_MANIFEST = Object.freeze({
  app: 'lists',
  accepts: {
    list:        [{ type: 'list-item', op: 'addItem', default: true }],
    'list-item': [{ type: 'list-item', op: 'addItem', default: true }],   // sub-items → arbitrary nesting
  },
});

/** A self-contained lists service: per-circle store + policy-driven create/add/complete/remove + render tree. */
export function makeCircleLists({ dataSource, manifests } = {}) {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  registry.registerType('list', LIST_SCHEMA);
  registry.registerType('list-item', ITEM_SCHEMA);
  const stores = createCircleStores({ dataSource: dataSource || memoryDataSource(), registry });
  const s = (circleId) => stores.getStore(circleId);

  // The accepts policy: the lists declaration + any injected extras (other apps extending what a list holds).
  const policy = buildAcceptsPolicy([LISTS_ACCEPTS_MANIFEST, ...(Array.isArray(manifests) ? manifests : [])]);

  // Render shape per type — a node can-add iff its type accepts ≥1 child type (policy-driven, not hardcoded).
  const renderFor = (item) => {
    const canAdd = policy.acceptsFor(item.type).length > 0;
    if (item.type === 'list') return { label: item.text, canAdd };
    const done = item.completedAt != null;
    return {
      label: `${done ? '✓ ' : ''}${item.text}`,
      rowActions: done ? ['removeItem'] : ['markComplete', 'removeItem'],
      canAdd,
    };
  };

  return {
    createList: (circleId, text, by) => s(circleId).put({ type: 'list', text }, { by }),
    /**
     * Add a child to a container — the child TYPE is resolved from the container type's `accepts` (not fixed).
     * `opts.hint` names a specific accepted child type (e.g. a UI picker for an ambiguous container). Returns
     * the created child, or null when the container isn't found / accepts nothing / the type is ambiguous.
     */
    async addItem(circleId, containerId, text, by, { hint } = {}) {
      const store = s(circleId);
      const container = await store.get(containerId);
      if (!container) return null;
      const r = resolveAddInContainer({ container, acceptsFor: policy.acceptsFor, body: hint ? `${hint} ${text}` : text });
      if (!r || r.ambiguous) return null;   // ambiguous → the shell should pick a type (a follow-up); lists has a default
      const childText = (r.body && r.body.trim()) ? r.body.trim() : text;
      return addChildTo(store, containerId, { type: r.type, text: childText, completedAt: null, createdBy: by });
    },
    async markDone(circleId, itemId, by) {
      const it = await s(circleId).get(itemId);
      return it ? s(circleId).put({ ...it, completedAt: Date.now() }, { by }) : null;
    },
    remove:    (circleId, itemId) => s(circleId).delete(itemId),
    listLists: (circleId) => s(circleId).listByType('list'),
    tree:      (circleId, listId) => projectContainer(s(circleId), listId, { renderFor }),
    acceptsFor: policy.acceptsFor,   // exposed so a shell can offer a type picker when a container is ambiguous
  };
}
