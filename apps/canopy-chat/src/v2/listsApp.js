/**
 * listsApp — the "Lists" app (formerly household) reborn as FUNCTIONS over a per-circle `CircleItemStore`
 * (cluster L · L3, proof-first). The dissolve made concrete:
 *   - NO agent, NO own store. A list is a `list` item; its entries are `list-item` CHILDREN (K2 containment).
 *   - Every op is a pure function over the circle store (the `app-origin` is now just a label/capability tag).
 *   - The app's data types (`list`, `list-item`) are registered via `registerType` — exactly as a third-party
 *     app would (dogfoods the registry extensibility that makes "store by type" safe).
 *
 * This is the proof that the substrate (CircleItemStore + containment + composable ops) carries a real app
 * with a fraction of the code — and removes the per-app-store/agent that caused the #49 class of scope bugs.
 * The legacy household agent stays until this is wired live in the app (the remaining L3 step). See
 * REMAINING-WORK.md cluster L.
 */
import { addChildTo, listChildren, uncontain } from '@canopy/item-store';

/** The Lists app's data types (registered onto a registry — the type source-of-truth, not the store). */
export const LIST_SCHEMA = Object.freeze({
  type: 'object',
  properties: { type: { const: 'list' }, text: { type: 'string', minLength: 1 } },
  required: ['type', 'text'],
});
export const LIST_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  properties: { type: { const: 'list-item' }, text: { type: 'string', minLength: 1 }, done: { type: 'boolean' } },
  required: ['type', 'text'],
});

/** Register the Lists types onto a registry (an `@canopy/item-types` `createRegistry()` instance). */
export function registerListTypes(registry) {
  registry.registerType('list', LIST_SCHEMA);
  registry.registerType('list-item', LIST_ITEM_SCHEMA);
}

/** The manifest `accepts` declaration (cluster K surfacing): a `list` accepts `list-item`s. */
export const LISTS_ACCEPTS = Object.freeze({ list: [{ type: 'list-item', op: 'lists.addItem', default: true }] });

// ── functions over the circle store (the whole "app") ───────────────────────────────────────────────────
/** Create a new list. */
export const createList = (store, { text, createdBy }) => store.put({ type: 'list', text, createdBy });
/** Add an entry to a list (a `list-item` child — K2 contained). */
export const addItem = (store, listId, { text, createdBy }) =>
  addChildTo(store, listId, { type: 'list-item', text, done: false, createdBy });
/** All lists in the circle (the type index). */
export const listAll = (store) => store.listByType('list');
/** A list with its entries resolved. */
export async function getList(store, listId) {
  const list = await store.get(listId);
  return list ? { ...list, items: await listChildren(store, listId) } : null;
}
/** Mark an entry done. */
export async function completeItem(store, itemId) {
  const it = await store.get(itemId);
  return it ? store.put({ ...it, done: true }) : null;
}
/** Remove an entry from its list (uncontain + delete the item). */
export async function removeItem(store, listId, itemId) {
  await uncontain(store, listId, itemId);
  await store.delete(itemId);
}
