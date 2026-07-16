/**
 * `createCirclesStore` — unit tests.
 *
 * Uses a minimal in-package fake ItemStore (duck-typed: addItems /
 * listOpen / getById / update).  Keeps the @onderling/circles package
 * free of any @onderling/item-store import; the consumer wires whichever
 * store they actually use in production.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createCirclesStore } from '../src/circlesStore.js';

/* ─── minimal fake ItemStore ─────────────────────────────────────── */

function makeFakeItemStore() {
  /** @type {Map<string, object>} */
  const items = new Map();
  let counter = 0;

  return {
    addItems: async (partials, ctx) => {
      const out = [];
      for (const p of partials) {
        if (typeof p.type !== 'string' || p.type === '') {
          throw new TypeError('fake addItems: type required');
        }
        if (typeof p.text !== 'string' || p.text === '') {
          // Mirror @onderling/item-store's substrate requirement so the
          // circles store's text:name workaround is actually exercised.
          throw new TypeError('fake addItems: text required (substrate compat check)');
        }
        const id = `id-${++counter}`;
        const item = {
          ...p,
          id,
          createdAt: new Date().toISOString(),
          createdBy: ctx?.actor ?? 'unknown',
        };
        items.set(id, item);
        out.push(item);
      }
      return out;
    },

    listOpen: async (filter) => {
      const out = [];
      for (const it of items.values()) {
        if (filter?.type && it.type !== filter.type) continue;
        out.push(it);
      }
      return out;
    },

    getById: async (id) => items.get(id) ?? null,

    update: async (id, patch, ctx) => {
      const cur = items.get(id);
      if (!cur) throw new Error(`fake update: missing ${id}`);
      const next = {
        ...cur,
        ...patch,
        updatedAt: new Date().toISOString(),
        updatedBy: ctx?.actor ?? 'unknown',
      };
      items.set(id, next);
      return next;
    },
  };
}

/* ─── tests ──────────────────────────────────────────────────────── */

describe('createCirclesStore', () => {
  let itemStore;
  let circles;

  beforeEach(() => {
    itemStore = makeFakeItemStore();
    circles   = createCirclesStore({ itemStore });
  });

  describe('contract', () => {
    it('rejects construction without an itemStore', () => {
      expect(() => createCirclesStore({})).toThrow(/itemStore required/);
    });

    it('rejects an itemStore missing required methods', () => {
      expect(() => createCirclesStore({ itemStore: { addItems: () => {} } }))
        .toThrow(/itemStore\.listOpen must be a function/);
    });
  });

  describe('create', () => {
    it('writes a circle item with text:name (substrate compat)', async () => {
      const c = await circles.create(
        { name: 'Gardening circle', members: ['alice', 'bob'] },
        { actor: 'me' },
      );
      expect(c.type).toBe('circle');
      expect(c.name).toBe('Gardening circle');
      expect(c.text).toBe('Gardening circle');
      expect(c.members).toEqual(['alice', 'bob']);
      expect(c.createdBy).toBe('me');
      expect(c.id).toBeTruthy();
    });

    it('members defaults to []', async () => {
      const c = await circles.create({ name: 'Empty' }, { actor: 'me' });
      expect(c.members).toEqual([]);
    });

    it('rejects empty name', async () => {
      await expect(circles.create({ name: '' }, { actor: 'me' }))
        .rejects.toThrow(/name \(non-empty string\) required/);
    });

    it('passes roles through when supplied', async () => {
      const c = await circles.create(
        { name: 'Team', members: ['a'], roles: { admin: ['a'] } },
        { actor: 'me' },
      );
      expect(c.roles).toEqual({ admin: ['a'] });
    });
  });

  describe('get / list', () => {
    it('get returns the circle', async () => {
      const c = await circles.create({ name: 'C1', members: [] }, { actor: 'me' });
      expect(await circles.get(c.id)).toMatchObject({ id: c.id, name: 'C1' });
    });

    it('get returns null for unknown id', async () => {
      expect(await circles.get('nope')).toBeNull();
    });

    it("get returns null for a non-circle item id (defensive)", async () => {
      // Inject a non-circle item directly into the fake store.
      await itemStore.addItems([{ type: 'task', text: 'a task' }], { actor: 'me' });
      const [task] = await itemStore.listOpen({ type: 'task' });
      expect(await circles.get(task.id)).toBeNull();
    });

    it('list returns only circles', async () => {
      await circles.create({ name: 'C1' }, { actor: 'me' });
      await circles.create({ name: 'C2' }, { actor: 'me' });
      // Inject a task — should NOT appear in list().
      await itemStore.addItems([{ type: 'task', text: 'a task' }], { actor: 'me' });

      const all = await circles.list();
      expect(all).toHaveLength(2);
      expect(all.map((c) => c.name).sort()).toEqual(['C1', 'C2']);
    });
  });

  describe('update / addMember / removeMember', () => {
    it('update patches fields and mirrors name → text', async () => {
      const c = await circles.create({ name: 'old', members: [] }, { actor: 'me' });
      const upd = await circles.update(c.id, { name: 'new' }, { actor: 'me' });
      expect(upd.name).toBe('new');
      expect(upd.text).toBe('new');
    });

    it('update on missing id throws', async () => {
      await expect(circles.update('nope', { name: 'x' }, { actor: 'me' }))
        .rejects.toThrow(/not found/);
    });

    it('update refuses to operate on non-circle items', async () => {
      await itemStore.addItems([{ type: 'task', text: 'a task' }], { actor: 'me' });
      const [task] = await itemStore.listOpen({ type: 'task' });
      await expect(circles.update(task.id, { name: 'x' }, { actor: 'me' }))
        .rejects.toThrow(/not a circle/);
    });

    it('addMember appends', async () => {
      const c = await circles.create({ name: 'C', members: ['a'] }, { actor: 'me' });
      const upd = await circles.addMember(c.id, 'b', { actor: 'me' });
      expect(upd.members).toEqual(['a', 'b']);
    });

    it('addMember is idempotent', async () => {
      const c = await circles.create({ name: 'C', members: ['a'] }, { actor: 'me' });
      const upd = await circles.addMember(c.id, 'a', { actor: 'me' });
      expect(upd.members).toEqual(['a']);
    });

    it('removeMember drops the entry', async () => {
      const c = await circles.create({ name: 'C', members: ['a', 'b'] }, { actor: 'me' });
      const upd = await circles.removeMember(c.id, 'a', { actor: 'me' });
      expect(upd.members).toEqual(['b']);
    });

    it('removeMember is no-op when absent', async () => {
      const c = await circles.create({ name: 'C', members: ['a'] }, { actor: 'me' });
      const upd = await circles.removeMember(c.id, 'nobody', { actor: 'me' });
      expect(upd.members).toEqual(['a']);
    });
  });
});
