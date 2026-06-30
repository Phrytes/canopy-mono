/**
 * CircleItemStore — a generic, per-circle, TYPE-INDEXED item store (cluster L · L1, the keystone).
 *
 * The data half of the dissolve: storage is keyed by **circle (scope) + data-type**, NOT by app-origin.
 * One store per circle (the `rootContainer` is the circle's routed pod path — `PodRouting` already keys the
 * pod by `crewId ≡ circleId`). Items are typed (`{id, type, …}`) and validated against the injected registry
 * (`@canopy/item-types`) on write. So ANY function over the registry's types can read/write here, and
 * `app-origin` is demoted to a capability/provenance TAG, not the storage key.
 *
 * Deliberately MINIMAL + generic: pure typed CRUD + a `type` index. Type-specific lifecycle (a task's
 * claim/submit/approve, a list's ordering, …) lives in FUNCTIONS over this store — NOT baked in here (that
 * coupling is exactly what the per-app `ItemStore` had, and what dissolve unwinds). Cross-peer propagation
 * (decentralised tier) + sealing are layered by the substrate (PodRouting + the SealedPodClient DataSource),
 * NOT this class — `dataSource` is injected, so a sealed/pod-backed source plugs in transparently.
 *
 * Isolation is preserved WITHOUT app-keyed storage: the per-circle SEAL + the capability boundary (cluster B)
 * gate access, so mixing apps' typed items in one circle store loses nothing. (See REMAINING-WORK.md cluster L.)
 *
 * @example
 *   const store = new CircleItemStore({ dataSource, rootContainer, registry });
 *   await store.put({ type: 'task', text: 'fix the tap' });   // validated, id assigned
 *   await store.listByType('task');                            // the type index
 */
import { ulid } from './ulid.js';

const ITEMS_DIR = 'items';

export class CircleItemStore {
  /** @type {import('@canopy/core').DataSource} */ #source;
  /** @type {string} */                            #root;
  /** @type {((item:object)=>{ok:boolean,errors?:Array})|null} */ #validate;

  /**
   * @param {object} args
   * @param {import('@canopy/core').DataSource} args.dataSource  read/write/delete/list (routed to the circle's pod)
   * @param {string} args.rootContainer  the circle's store root (e.g. a PodRouting-resolved `…/<circleId>/`)
   * @param {{ validate?: (item:object)=>{ok:boolean,errors?:Array} }} [args.registry]  @canopy/item-types registry;
   *        when present, `put` rejects items that fail `validate`. Injected (no hard dep) — pass a fresh
   *        `createRegistry()` (with any third-party `registerType`d schemas) or the default canonical one.
   */
  constructor({ dataSource, rootContainer, registry } = {}) {
    if (!dataSource || typeof dataSource.read !== 'function' || typeof dataSource.write !== 'function') {
      throw new Error('CircleItemStore: dataSource (core.DataSource: read/write/delete/list) required');
    }
    if (typeof rootContainer !== 'string' || !rootContainer) {
      throw new Error('CircleItemStore: rootContainer required');
    }
    this.#source   = dataSource;
    this.#root     = rootContainer.endsWith('/') ? rootContainer : `${rootContainer}/`;
    this.#validate = registry && typeof registry.validate === 'function' ? registry.validate : null;
  }

  #uri(id) { return `${this.#root}${ITEMS_DIR}/${id}.json`; }

  /**
   * Create or replace a typed item. Requires `item.type` (validated against the registry when one is
   * injected); assigns a ULID `id` when absent. Returns the stored item (with its `id`).
   */
  async put(item, { by, now } = {}) {
    if (!item || typeof item !== 'object') throw new Error('CircleItemStore.put: an item object is required');
    if (typeof item.type !== 'string' || !item.type) throw new Error('CircleItemStore.put: item.type is required');
    const id = (typeof item.id === 'string' && item.id) ? item.id : ulid();
    // Stamp the base metadata (BASE_REQUIRED: type·id·createdAt·createdBy) so every item is well-formed +
    // validates against strict canonical schemas. createdAt/createdBy are PRESERVED on replace; updatedAt is
    // always the write time. `by` (the actor) is injectable; `now` (an ISO-string clock) for deterministic tests.
    const ts = (typeof now === 'function' ? now() : now) ?? new Date().toISOString();
    const stored = {
      ...item,
      id,
      createdAt: item.createdAt ?? ts,
      createdBy: item.createdBy ?? by ?? 'unknown',
      updatedAt: ts,
      updatedBy: by ?? item.createdBy ?? 'unknown',
    };
    if (this.#validate) {
      const res = this.#validate(stored);
      if (res && res.ok === false) {
        const msg = (res.errors || []).map((e) => e?.message || JSON.stringify(e)).join('; ');
        throw new Error(`CircleItemStore.put: invalid "${stored.type}": ${msg || 'unknown type / schema error'}`);
      }
    }
    await this.#source.write(this.#uri(id), JSON.stringify(stored));
    return stored;
  }

  /** Read one item by id, or `null` if absent. */
  async get(id) {
    const raw = await this.#source.read(this.#uri(id));
    if (raw === null || raw === undefined) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  /** Delete one item by id (no-op if absent, mirroring DataSource.delete). */
  async delete(id) {
    if (typeof this.#source.delete === 'function') await this.#source.delete(this.#uri(id));
  }

  /** Every item in the circle (all types). */
  async list() {
    const keys = await this.#source.list(`${this.#root}${ITEMS_DIR}/`);
    const out = [];
    for (const k of (keys || [])) {
      const raw = await this.#source.read(k);
      if (raw === null || raw === undefined) continue;
      try { out.push(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { /* skip malformed */ }
    }
    return out;
  }

  /**
   * Items of a given canonical `type` — the type index ("all tasks in this circle", "all offers").
   * v0 filters on `list()`; a maintained per-type index (e.g. `byType/<type>/<id>` markers) is a later
   * optimisation once write volume warrants it.
   */
  async listByType(type) {
    const all = await this.list();
    return all.filter((it) => it && it.type === type);
  }
}
