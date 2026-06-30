/**
 * householdApp — the Household / "Lists" app dissolved onto the per-circle CircleItemStore (cluster L · L3),
 * PRESERVING its real ops + model (Frits 2026-06-30: re-home storage, don't re-invent functionality).
 *
 * Household's model, unchanged: typed lists `shopping`/`errand`/`repair`/`schedule` + `task`s, each an item
 * with `text` and `completedAt` (null = open); complete/remove/claim resolve a `match` by text. The ONLY
 * change vs the legacy household agent is WHERE the data lives — one per-circle `CircleItemStore` instead of
 * a per-app `HouseholdStore` — so the existing `household` manifest (ops + gate/slash/LLM surfaces) keeps
 * working unchanged; `app-origin` is now a capability tag, not the storage key.
 *
 * The list types are registered via `registerType` (third-party-style); `task` is canonical. Every op is a
 * pure function over the circle store — no agent, no own store. (REMAINING-WORK.md cluster L.)
 */
import { createCircleStores, memoryDataSource } from '@canopy/item-store';
import { createRegistry, registerCanonicalTypes } from '@canopy/item-types';

export const LIST_TYPES = Object.freeze(['shopping', 'errand', 'repair', 'schedule']);
const COMPLETABLE = Object.freeze([...LIST_TYPES, 'task']);   // markComplete/removeItem search these (mirrors the manifest appliesTo)

const listTypeSchema = (t) => ({
  type: 'object',
  properties: { type: { const: t }, text: { type: 'string', minLength: 1 }, completedAt: { type: ['number', 'null'] } },
  required: ['type', 'text'],
});

/** Register household's list types onto a registry (`task` is canonical, already registered). */
export function registerHouseholdTypes(registry) {
  for (const t of LIST_TYPES) registry.registerType(t, listTypeSchema(t));
}

/** A registry: canonical types + household's list types. */
export function householdRegistry() {
  const reg = createRegistry();
  registerCanonicalTypes(reg);
  registerHouseholdTypes(reg);
  return reg;
}

/** Find an OPEN item (completedAt null) whose text contains `match`, among `types` (mirrors the skill logic). */
async function findOpenByMatch(store, match, types) {
  const needle = String(match ?? '').toLowerCase().trim();
  if (!needle) return null;
  for (const t of types) {
    const open = (await store.listByType(t)).filter((i) => i.completedAt == null);
    const hit = open.find((i) => String(i.text ?? '').toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return null;
}

// ── household's ops, faithful, over the circle store (ctx.by = the acting member) ──────────────────────
export const addItem = (store, { type, text }, { by } = {}) => store.put({ type, text, completedAt: null }, { by });
export const listOpen = async (store, { type }) => (await store.listByType(type)).filter((i) => i.completedAt == null);
export async function markComplete(store, { match }, { by } = {}) {
  const it = await findOpenByMatch(store, match, COMPLETABLE);
  if (!it) return { ok: false, error: 'item not found' };
  return { ok: true, item: await store.put({ ...it, completedAt: Date.now() }, { by }) };
}
export async function removeItem(store, { match }) {
  const it = await findOpenByMatch(store, match, COMPLETABLE);
  if (!it) return { ok: false, error: 'item not found' };
  await store.delete(it.id);
  return { ok: true, removed: it.id };
}
export const addTask = (store, { text, assignee, dueAt }, { by } = {}) =>
  store.put({ type: 'task', text, completedAt: null, ...(assignee ? { assignee } : {}), ...(dueAt ? { dueAt } : {}) }, { by });
export const listTasks = async (store) => (await store.listByType('task')).filter((i) => i.completedAt == null);
export async function claim(store, { match }, { by } = {}) {
  const it = await findOpenByMatch(store, match, ['task']);
  if (!it) return { ok: false, error: 'item not found' };
  return { ok: true, item: await store.put({ ...it, assignee: by }, { by }) };
}
export async function reassign(store, { match, assignee }, { by } = {}) {
  const it = await findOpenByMatch(store, match, ['task']);
  if (!it) return { ok: false, error: 'item not found' };
  return { ok: true, item: await store.put({ ...it, assignee }, { by }) };
}

const OPS = { addItem, listOpen, markComplete, removeItem, addTask, listTasks, claim, reassign };

/**
 * createHouseholdService — the existing `household` ops callable via the standard callSkill shape, now backed
 * by the per-circle store. Additive: routes `callSkill('household', op, args, {circleId, by})` to the ops.
 * No-pod default = in-memory; a real boot injects a persistent/sealed DataSource. Retires the legacy agent
 * once this is the live path.
 */
export function createHouseholdService({ dataSource, registry } = {}) {
  const stores = createCircleStores({ dataSource: dataSource || memoryDataSource(), registry: registry || householdRegistry() });
  return {
    async callSkill(op, args = {}, ctx = {}) {
      const circleId = ctx.circleId ?? args.circleId;
      if (!circleId) throw new Error('householdService.callSkill: a circleId is required (scope)');
      const fn = OPS[op];
      if (!fn) throw new Error(`householdService.callSkill: unknown op "${op}"`);
      return fn(stores.getStore(circleId), args, ctx);
    },
    stores,
  };
}
