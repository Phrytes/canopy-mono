/**
 * createGenericAtomHandlers — the store-backed generic CRUD handlers that make "declare a noun → get CRUD
 * for free" real (PLAN-capability-arc §1b). Keyed by CANONICAL atom; each takes `(noun, args, ctx)` and
 * operates on ANY item type via a CircleItemStore-shaped store (`put` / `get` / `delete` / `listByType`).
 * The noun IS the item type — no per-noun code.
 *
 * The point: an app that DECLARES a noun in its manifest (a `(verb×noun)` surface) but writes NO bespoke
 * handler for a standard atom can route that `(atom, noun)` here. Bespoke ops still win where one exists
 * (`resolveAtom`); these are the fallback the manifest's declared-but-unimplemented atoms resolve to — so
 * a new app = "declare a noun + which atoms" and the CRUD is served, unwritten.
 *
 * Store-shaped, not app-shaped — reply formatting / side-effects / sealing stay above this. Every handler
 * returns a plain `{ ok, ... }` result; a caller maps it to whatever reply/envelope shape it needs.
 *
 * @param {{ put:Function, get:Function, delete:Function, listByType:Function }} store  a CircleItemStore (or same shape)
 * @returns {{ add:Function, list:Function, get:Function, update:Function, remove:Function }}  handlers keyed by canonical atom
 */
export function createGenericAtomHandlers(store) {
  if (!store || typeof store.put !== 'function' || typeof store.listByType !== 'function') {
    throw new Error('createGenericAtomHandlers: a CircleItemStore-shaped store (put/get/delete/listByType) is required');
  }
  const stripped = (args) => {
    const { type: _t, id: _i, ...rest } = (args && typeof args === 'object') ? args : {};
    return rest;
  };
  return {
    // create a typed item — the noun is authoritative; any `type`/`id` in args is ignored/assigned by the store.
    async add(noun, args = {}, ctx = {}) {
      const item = await store.put({ ...stripped(args), type: noun }, { by: ctx.by, now: ctx.now });
      return { ok: true, item };
    },
    async list(noun) {
      return { ok: true, items: await store.listByType(noun) };
    },
    async get(noun, args = {}) {
      const item = args?.id ? await store.get(args.id) : null;
      return (item && item.type === noun) ? { ok: true, item } : { ok: false, code: 'not-found' };
    },
    async update(noun, args = {}, ctx = {}) {
      if (!args?.id) return { ok: false, code: 'id-required' };
      const cur = await store.get(args.id);
      if (!cur || cur.type !== noun) return { ok: false, code: 'not-found' };
      const item = await store.put({ ...cur, ...stripped(args), id: args.id, type: noun }, { by: ctx.by, now: ctx.now });
      return { ok: true, item };
    },
    async remove(noun, args = {}, ctx = {}) {
      if (!args?.id) return { ok: false, code: 'id-required' };
      const cur = await store.get(args.id);
      if (!cur || cur.type !== noun) return { ok: false, code: 'not-found' };
      await store.delete(args.id, { sync: ctx.sync !== false });
      return { ok: true, id: args.id };
    },
  };
}
