/**
 * ItemStore — the public API.
 *
 * **Migrated 2026-05-04 (Phase 5.2 of substrate refactor).**  The
 * pre-2026-05-04 version had a custom `Backend` interface (whose only
 * implementation was the synthetic `InMemoryBackend`) that duplicated
 * `core.DataSource`. Per the L1b audit, the substrate now composes a
 * `core.DataSource` directly — `MemorySource` for tests, an adapter
 * over `pod-client.PodClient` for production. No reinvented Backend.
 *
 * Storage layout (under `rootContainer`):
 *   - `items/<id>.json`   — the item state (open or closed; check
 *                           `completedAt` to disambiguate).
 *   - `audit/<entry-id>.json` — one audit entry per file. Listing
 *                           `audit/` returns all entries.
 *
 * Per-field merge contracts (unchanged conceptually):
 *  - Body fields (text, notes, dependencies, requiredSkills, dueAt,
 *    visibility) — LWW.
 *  - assignee — compare-and-swap (claim race resolution) via
 *    `_etag` round-trip in the substrate; for true distributed atomicity,
 *    pair with a `pod-client.PodClient`-backed DataSource that honours
 *    `ifMatch` / `If-None-Match` at the HTTP layer.
 *  - completedAt + completedBy — LWW; role-policy gates duplicate completes.
 *  - audit log — append-only (one file per entry; never edited).
 */

import { Emitter } from '@canopy/core';

import { ulid } from './ulid.js';
import {
  ItemNotFoundError,
  PermissionDeniedError,
  InvalidLifecycleError,
} from './errors.js';

const NOOP_POLICY = Object.freeze({});

const ID_PREFIX_LEN = 8;
const MIN_PREFIX_LEN = 6;

const ITEMS_DIR = 'items';
const AUDIT_DIR = 'audit';

export class ItemStore extends Emitter {
  /** @type {import('@canopy/core').DataSource} */
  #source;

  /** @type {string} root URI prefix (always ends in '/') */
  #root;

  /** @type {import('./types.js').RolePolicy} */
  #policy;

  /**
   * @param {object} args
   * @param {import('@canopy/core').DataSource} args.dataSource
   *   Any `core.DataSource` subclass. `MemorySource` for tests; an
   *   adapter over `pod-client.PodClient` for Solid-pod production.
   * @param {string} args.rootContainer
   *   URI / path prefix under which `items/` and `audit/` live.
   *   Trailing '/' is normalised.
   * @param {import('./types.js').RolePolicy} [args.rolePolicy]
   *   Optional gate; default is no-op (everything allowed).
   */
  constructor({ dataSource, rootContainer, rolePolicy }) {
    super();
    if (!dataSource || typeof dataSource.read !== 'function') {
      throw new Error('ItemStore: dataSource (core.DataSource) required');
    }
    if (typeof rootContainer !== 'string' || !rootContainer) {
      throw new Error('ItemStore: rootContainer required');
    }
    this.#source = dataSource;
    this.#root   = rootContainer.endsWith('/') ? rootContainer : rootContainer + '/';
    this.#policy = rolePolicy ?? NOOP_POLICY;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Add one or more items.  Substrate generates ids + addedAt.
   * @param {Array<Partial<import('./types.js').Item>>} items
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item[]>}
   * @fires ItemStore#item-added
   */
  async addItems(items, ctx) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const actor = this.#requireActor(ctx);
    const persisted = [];
    for (const partial of items) {
      this.#validatePartial(partial);
      const item = this.#materialise(partial, ctx);
      this.#gate('canAdd', actor, item);
      await this.#writeItem(item);
      await this.#appendAudit({
        id: ulid(), itemId: item.id, action: 'add',
        actor, actorDisplayName: ctx.actorDisplayName,
        at: item.addedAt,
      });
      persisted.push(item);
      this.emit('item-added', item);
    }
    return persisted;
  }

  /**
   * List open items matching the filter.  "Open" = `completedAt` absent.
   * @param {import('./types.js').ListFilter} [filter]
   * @returns {Promise<import('./types.js').Item[]>}
   */
  async listOpen(filter) {
    const items = await this.#listAllItems();
    return this.#filterItems(items.filter((i) => !i.completedAt), filter);
  }

  /**
   * List closed items matching the filter.
   * @param {import('./types.js').ListFilter} [filter]
   * @returns {Promise<import('./types.js').Item[]>}
   */
  async listClosed(filter) {
    const items = await this.#listAllItems();
    return this.#filterItems(items.filter((i) => i.completedAt !== undefined && i.completedAt !== null), filter);
  }

  /**
   * Read a single item by id.
   * @param {string} id
   * @returns {Promise<import('./types.js').Item|null>}
   */
  async getById(id) {
    return this.#readItem(id);
  }

  /**
   * Mark items complete.
   * @param {Array<import('./types.js').ItemRef>} refs
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item[]>}
   * @fires ItemStore#item-completed
   */
  async markComplete(refs, ctx) {
    if (!Array.isArray(refs) || refs.length === 0) return [];
    const actor = this.#requireActor(ctx);
    const completed = [];
    for (const ref of refs) {
      const isExplicit = typeof ref?.id === 'string';
      const item = isExplicit
        ? await this.#readItem(ref.id)
        : await this.#resolveRef(ref);
      if (!item) {
        if (isExplicit) throw new ItemNotFoundError(ref.id);
        continue;
      }
      if (item.completedAt) {
        if (isExplicit) {
          throw new InvalidLifecycleError({
            itemId: item.id, currentState: 'completed', attemptedAction: 'complete',
          });
        }
        continue;
      }
      this.#gate('canComplete', actor, item);
      const at = Date.now();
      const updated = {
        ...item,
        completedAt: at,
        completedBy: actor,
        ...(ctx.actorDisplayName ? { completedByDisplayName: ctx.actorDisplayName } : {}),
        _etag: ulid(),
      };
      await this.#writeItem(updated);
      await this.#appendAudit({
        id: ulid(), itemId: item.id, action: 'complete',
        actor, actorDisplayName: ctx.actorDisplayName, at,
      });
      completed.push(updated);
      this.emit('item-completed', updated);
    }
    return completed;
  }

  /**
   * Hard-delete items.
   * @param {Array<import('./types.js').ItemRef>} refs
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<string[]>}
   * @fires ItemStore#item-removed
   */
  async removeItems(refs, ctx) {
    if (!Array.isArray(refs) || refs.length === 0) return [];
    const actor = this.#requireActor(ctx);
    const removed = [];
    for (const ref of refs) {
      const item = await this.#resolveRef(ref);
      if (!item) continue;
      this.#gate('canRemove', actor, item);
      await this.#deleteItem(item.id);
      await this.#appendAudit({
        id: ulid(), itemId: item.id, action: 'remove',
        actor, actorDisplayName: ctx.actorDisplayName,
        at: Date.now(),
      });
      removed.push(item.id);
      this.emit('item-removed', { id: item.id, item });
    }
    return removed;
  }

  /**
   * Compare-and-swap claim. Loser gets `{error:'already-claimed', current}`.
   * @param {string} id
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item | {error: 'already-claimed', current: import('./types.js').Item}>}
   * @fires ItemStore#item-claimed on success
   */
  async claim(id, ctx) {
    const actor = this.#requireActor(ctx);
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'claim',
      });
    }
    if (current.assignee) {
      return { error: 'already-claimed', current };
    }
    this.#gate('canClaim', actor, current);
    const at = Date.now();
    // CAS via read-check-write. For true distributed atomicity, pair the
    // store with a pod-client.PodClient-backed DataSource that honours
    // ifMatch at the HTTP layer.
    const updated = {
      ...current,
      assignee: actor,
      claimedAt: at,
      _etag: ulid(),
    };
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'claim',
      actor, actorDisplayName: ctx.actorDisplayName, at,
    });
    this.emit('item-claimed', updated);
    return updated;
  }

  /**
   * Reassign — role-policy-gated.
   * @param {string} id
   * @param {string|null} newAssignee
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   * @fires ItemStore#item-claimed (on reassign to a webid)
   * @fires ItemStore#item-updated (on release to null)
   */
  async reassign(id, newAssignee, ctx) {
    const actor = this.#requireActor(ctx);
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    if (current.completedAt) {
      throw new InvalidLifecycleError({
        itemId: id, currentState: 'completed', attemptedAction: 'reassign',
      });
    }
    this.#gate('canReassign', actor, current);
    const at = Date.now();
    const updated = {
      ...current,
      assignee: newAssignee ?? undefined,
      claimedAt: newAssignee ? at : undefined,
      _etag: ulid(),
    };
    if (!newAssignee) delete updated.assignee;
    if (!newAssignee) delete updated.claimedAt;
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'reassign',
      actor, actorDisplayName: ctx.actorDisplayName, at,
      details: { from: current.assignee ?? null, to: newAssignee },
    });
    if (newAssignee) {
      this.emit('item-claimed', updated);
    } else {
      this.emit('item-updated', updated);
    }
    return updated;
  }

  /**
   * Edit body fields (LWW). Forbids attribution / completion / assignment edits.
   * @param {string} id
   * @param {Partial<import('./types.js').Item>} patch
   * @param {import('./types.js').ActorContext} ctx
   * @returns {Promise<import('./types.js').Item>}
   * @fires ItemStore#item-updated
   */
  async update(id, patch, ctx) {
    const actor = this.#requireActor(ctx);
    const current = await this.#readItem(id);
    if (!current) throw new ItemNotFoundError(id);
    this.#assertEditableFields(patch);
    this.#gate('canEditBody', actor, current, patch);
    const updated = {
      ...current,
      ...patch,
      _etag: ulid(),
    };
    await this.#writeItem(updated);
    await this.#appendAudit({
      id: ulid(), itemId: id, action: 'update',
      actor, actorDisplayName: ctx.actorDisplayName, at: Date.now(),
      details: { fields: Object.keys(patch) },
    });
    this.emit('item-updated', updated);
    return updated;
  }

  /**
   * Read the audit log.  Filterable by item / actor / action / time.
   * @param {import('./types.js').AuditFilter} [filter]
   * @returns {Promise<import('./types.js').AuditEntry[]>}
   */
  async auditLog(filter) {
    return this.#listAudit(filter);
  }

  // ── Storage helpers (DataSource-backed) ─────────────────────────────────

  #itemUri(id)  { return `${this.#root}${ITEMS_DIR}/${id}.json`; }
  #auditUri(id) { return `${this.#root}${AUDIT_DIR}/${id}.json`; }

  async #writeItem(item) {
    await this.#source.write(this.#itemUri(item.id), JSON.stringify(item));
  }

  async #readItem(id) {
    const raw = await this.#source.read(this.#itemUri(id));
    if (raw === null || raw === undefined) return null;
    return parseItem(raw);
  }

  async #deleteItem(id) {
    await this.#source.delete(this.#itemUri(id));
  }

  async #listAllItems() {
    const prefix = `${this.#root}${ITEMS_DIR}/`;
    const keys = await this.#source.list(prefix);
    const out = [];
    for (const key of keys) {
      const raw = await this.#source.read(key);
      if (raw === null || raw === undefined) continue;
      const parsed = parseItem(raw);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async #appendAudit(entry) {
    await this.#source.write(this.#auditUri(entry.id), JSON.stringify(entry));
  }

  async #listAudit(filter) {
    const prefix = `${this.#root}${AUDIT_DIR}/`;
    const keys = await this.#source.list(prefix);
    const entries = [];
    for (const key of keys) {
      const raw = await this.#source.read(key);
      if (raw === null || raw === undefined) continue;
      const parsed = parseItem(raw);
      if (parsed) entries.push(parsed);
    }
    return applyAuditFilter(entries, filter);
  }

  // ── Filtering ───────────────────────────────────────────────────────────

  #filterItems(items, filter) {
    if (!filter) return [...items];
    let out = items;
    if (typeof filter.type === 'string') {
      out = out.filter((i) => i.type === filter.type);
    }
    if (typeof filter.requiredSkill === 'string') {
      const want = filter.requiredSkill;
      out = out.filter((i) => Array.isArray(i.requiredSkills) && i.requiredSkills.includes(want));
    }
    if ('assignee' in filter) {
      if (filter.assignee === null) {
        out = out.filter((i) => !i.assignee);
      } else if (typeof filter.assignee === 'string') {
        out = out.filter((i) => i.assignee === filter.assignee);
      }
    }
    return out;
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  #materialise(partial, ctx) {
    return {
      id:                   ulid(),
      type:                 partial.type,
      text:                 partial.text,
      ...(partial.notes ? { notes: partial.notes } : {}),
      addedBy:              ctx.actor,
      ...(ctx.actorDisplayName ? { addedByDisplayName: ctx.actorDisplayName } : {}),
      addedAt:              Date.now(),
      ...(partial.dependencies ? { dependencies: [...partial.dependencies] } : {}),
      ...(partial.requiredSkills ? { requiredSkills: [...partial.requiredSkills] } : {}),
      ...(partial.dueAt !== undefined ? { dueAt: partial.dueAt } : {}),
      ...(partial.visibility ? { visibility: partial.visibility } : {}),
      ...(partial.source ? { source: partial.source } : {}),
      _etag: ulid(),
    };
  }

  #validatePartial(partial) {
    if (!partial || typeof partial !== 'object') {
      throw new TypeError('addItems: each item must be an object');
    }
    if (typeof partial.type !== 'string' || partial.type.length === 0) {
      throw new TypeError('addItems: each item requires a non-empty `type`');
    }
    if (typeof partial.text !== 'string' || partial.text.trim().length === 0) {
      throw new TypeError('addItems: each item requires a non-empty `text`');
    }
  }

  #requireActor(ctx) {
    if (!ctx || typeof ctx.actor !== 'string' || ctx.actor.length === 0) {
      throw new TypeError('ActorContext.actor (webid) is required');
    }
    return ctx.actor;
  }

  #gate(method, actor, item, patch) {
    const fn = this.#policy[method];
    if (typeof fn !== 'function') return;
    const allowed = fn(actor, item, patch);
    if (!allowed) {
      throw new PermissionDeniedError({
        action: method.replace(/^can/, '').toLowerCase(),
        actor,
        itemId: item?.id,
      });
    }
  }

  #assertEditableFields(patch) {
    const forbidden = [
      'id', 'addedBy', 'addedByDisplayName', 'addedAt',
      'completedAt', 'completedBy', 'completedByDisplayName',
      'assignee', 'claimedAt',
    ];
    for (const f of forbidden) {
      if (f in patch) {
        throw new TypeError(
          `update: field '${f}' is not editable through update(); use the dedicated primitive.`,
        );
      }
    }
  }

  async #resolveRef(ref) {
    if (ref && typeof ref.id === 'string') {
      const item = await this.#readItem(ref.id);
      if (item && !item.completedAt) return item;
      return null;
    }
    if (ref && typeof ref.match === 'string' && ref.match.trim().length > 0) {
      const all = await this.#listAllItems();
      const open = all.filter((i) => !i.completedAt);
      return resolveFuzzy(open, ref.match);
    }
    return null;
  }
}

// ── Module-private helpers ────────────────────────────────────────────────

function parseItem(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  // MemorySource may return non-string values directly; pass through.
  if (typeof raw === 'object') return raw;
  return null;
}

function applyAuditFilter(entries, filter) {
  if (!filter) return entries;
  let out = entries;
  if (filter.itemId) out = out.filter((e) => e.itemId === filter.itemId);
  if (filter.actor)  out = out.filter((e) => e.actor  === filter.actor);
  if (filter.action) out = out.filter((e) => e.action === filter.action);
  if (typeof filter.since === 'number') out = out.filter((e) => e.at >= filter.since);
  if (typeof filter.until === 'number') out = out.filter((e) => e.at <= filter.until);
  // Stable order by `at` then `id`.
  return out.sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : 1));
}

function resolveFuzzy(items, match) {
  const m = match.trim();
  const exact = items.find((i) => i.id === m);
  if (exact) return exact;
  if (m.length >= MIN_PREFIX_LEN) {
    const upper = m.toUpperCase();
    const prefixHit = items.find((i) => i.id.startsWith(upper));
    if (prefixHit) return prefixHit;
  }
  const lower = m.toLowerCase();
  const textHit = items.find((i) => i.text.toLowerCase().includes(lower));
  return textHit ?? null;
}

export { ID_PREFIX_LEN, MIN_PREFIX_LEN };
