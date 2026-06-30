/**
 * circleLists — the composable LISTS feature over the K2 substrate (cluster K · K2, the container UI).
 *
 * A generic `list` CONTAINER whose entries are `list-item` CHILDREN (K2 containment) — the offer→list→tasks
 * model made into a usable feature, distinct from household's faithful typed-lists (L3). One per-circle
 * `CircleItemStore`; the panel (circleApp.openListsPanel) renders a list via `projectContainer` +
 * `renderContainerCard`, and "+ add" creates a contained `list-item`.
 *
 * v0 storage is in-memory (`memoryDataSource`) — lists don't survive a reload yet; swapping in a persistent/
 * sealed DataSource is a follow-up (the store is DataSource-agnostic). web≡mobile: mobile reuses this module.
 */
import { createCircleStores, memoryDataSource, addChildTo, projectContainer } from '@canopy/item-store';
import { createRegistry, registerCanonicalTypes } from '@canopy/item-types';

const LIST_SCHEMA = Object.freeze({
  type: 'object', properties: { type: { const: 'list' }, text: { type: 'string', minLength: 1 } }, required: ['type', 'text'],
});
const ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: { type: { const: 'list-item' }, text: { type: 'string', minLength: 1 }, completedAt: { type: ['number', 'null'] } },
  required: ['type', 'text'],
});

/** Render shape per type (cluster K surfacing): a list can-add; an item shows complete/remove row-actions. */
function renderFor(item) {
  if (item.type === 'list') return { label: item.text, canAdd: true };
  const done = item.completedAt != null;
  return { label: `${done ? '✓ ' : ''}${item.text}`, rowActions: done ? ['removeItem'] : ['markComplete', 'removeItem'] };
}

/** A self-contained lists service: per-circle store + the create/add/complete/remove ops + the render tree. */
export function makeCircleLists({ dataSource } = {}) {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  registry.registerType('list', LIST_SCHEMA);
  registry.registerType('list-item', ITEM_SCHEMA);
  const stores = createCircleStores({ dataSource: dataSource || memoryDataSource(), registry });
  const s = (circleId) => stores.getStore(circleId);

  return {
    createList: (circleId, text, by) => s(circleId).put({ type: 'list', text }, { by }),
    addItem:    (circleId, listId, text, by) => addChildTo(s(circleId), listId, { type: 'list-item', text, completedAt: null, createdBy: by }),
    async markDone(circleId, itemId, by) {
      const it = await s(circleId).get(itemId);
      return it ? s(circleId).put({ ...it, completedAt: Date.now() }, { by }) : null;
    },
    remove:    (circleId, itemId) => s(circleId).delete(itemId),
    listLists: (circleId) => s(circleId).listByType('list'),
    tree:      (circleId, listId) => projectContainer(s(circleId), listId, { renderFor }),
  };
}
