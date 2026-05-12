/**
 * embeds — treeOf walks dependencies + embeds with placeholder
 * handling for cross-pod refs.
 */

import { describe, it, expect } from 'vitest';
import { treeOf } from '../src/embeds.js';

/** In-memory store helper for tests. */
function mkStore(items) {
  const byId = new Map(items.map(i => [i.id, i]));
  return async (id) => byId.get(id) ?? null;
}

describe('treeOf — input validation', () => {
  it('throws on missing rootId', async () => {
    await expect(treeOf({ getItem: async () => null })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('throws on missing getItem', async () => {
    await expect(treeOf({ rootId: 'x' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('treeOf — dependency walk', () => {
  it('returns leaf when no deps + no embeds', async () => {
    const getItem = mkStore([{ id: 'a', type: 'task', text: 'A' }]);
    const tree = await treeOf({ rootId: 'a', getItem });
    expect(tree).toMatchObject({ id: 'a', type: 'task', source: 'local', subtasks: [], embeds: [] });
  });

  it('walks two-level subtasks', async () => {
    const getItem = mkStore([
      { id: 'parent', type: 'task', dependencies: ['child1', 'child2'] },
      { id: 'child1', type: 'task' },
      { id: 'child2', type: 'task', dependencies: ['grandchild'] },
      { id: 'grandchild', type: 'task' },
    ]);
    const tree = await treeOf({ rootId: 'parent', getItem });
    expect(tree.subtasks.map(s => s.id)).toEqual(['child1', 'child2']);
    expect(tree.subtasks[1].subtasks.map(s => s.id)).toEqual(['grandchild']);
  });

  it('missing dep id → placeholder NOT_FOUND', async () => {
    const getItem = mkStore([
      { id: 'parent', dependencies: ['ghost'] },
    ]);
    const tree = await treeOf({ rootId: 'parent', getItem });
    expect(tree.subtasks[0]).toMatchObject({
      id:     'ghost',
      source: 'placeholder',
      reason: 'NOT_FOUND',
    });
  });

  it('cycle → placeholder CYCLE_OR_DEPTH', async () => {
    const getItem = mkStore([
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] },
    ]);
    const tree = await treeOf({ rootId: 'a', getItem });
    expect(tree.subtasks[0].subtasks[0]).toMatchObject({
      id:     'a',
      source: 'placeholder',
      reason: 'CYCLE_OR_DEPTH',
    });
  });

  it('respects maxDepth', async () => {
    // Chain: a → b → c → d → e (depth 4)
    const getItem = mkStore([
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['c'] },
      { id: 'c', dependencies: ['d'] },
      { id: 'd', dependencies: ['e'] },
      { id: 'e' },
    ]);
    const tree = await treeOf({ rootId: 'a', getItem, maxDepth: 2 });
    // a@0 → b@1 → c@2 → d@3 (exceeds maxDepth → placeholder)
    expect(tree.subtasks[0].subtasks[0].subtasks[0]).toMatchObject({
      source: 'placeholder',
      reason: 'CYCLE_OR_DEPTH',
    });
  });
});

describe('treeOf — embeds walk', () => {
  it('placeholder NO_RESOLVER when no callback supplied', async () => {
    const getItem = mkStore([
      { id: 'a', embeds: [{ type: 'note', ref: 'https://other.pod/notes/x' }] },
    ]);
    const tree = await treeOf({ rootId: 'a', getItem });
    expect(tree.embeds[0]).toMatchObject({
      type:   'note',
      ref:    'https://other.pod/notes/x',
      source: 'placeholder',
      reason: 'NO_RESOLVER',
    });
  });

  it('resolves external ref via callback', async () => {
    const getItem = mkStore([
      { id: 'a', embeds: [{ type: 'note', ref: 'https://other.pod/notes/x' }] },
    ]);
    const resolveExternalRef = async (ref) => {
      if (ref === 'https://other.pod/notes/x') {
        return { item: { id: 'note-1', type: 'note', body: 'remote note' } };
      }
      return null;
    };
    const tree = await treeOf({ rootId: 'a', getItem, resolveExternalRef });
    expect(tree.embeds[0]).toMatchObject({
      id:     'note-1',
      type:   'note',
      ref:    'https://other.pod/notes/x',
      source: 'external',
    });
    expect(tree.embeds[0].item).toMatchObject({ body: 'remote note' });
  });

  it('resolver throwing → placeholder with err.code reason', async () => {
    const getItem = mkStore([
      { id: 'a', embeds: [{ type: 'note', ref: 'https://other.pod/x' }] },
    ]);
    const resolveExternalRef = async () => {
      throw Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED' });
    };
    const tree = await treeOf({ rootId: 'a', getItem, resolveExternalRef });
    expect(tree.embeds[0]).toMatchObject({
      source: 'placeholder',
      reason: 'PERMISSION_DENIED',
    });
  });

  it('resolver returning null → placeholder NOT_FOUND', async () => {
    const getItem = mkStore([
      { id: 'a', embeds: [{ type: 'note', ref: 'https://other.pod/x' }] },
    ]);
    const tree = await treeOf({
      rootId: 'a',
      getItem,
      resolveExternalRef: async () => null,
    });
    expect(tree.embeds[0].reason).toBe('NOT_FOUND');
  });

  it('bad embed (missing ref) → placeholder BAD_EMBED', async () => {
    const getItem = mkStore([
      { id: 'a', embeds: [{ type: 'note' /* no ref */ }] },
    ]);
    const tree = await treeOf({ rootId: 'a', getItem });
    expect(tree.embeds[0]).toMatchObject({
      source: 'placeholder',
      reason: 'BAD_EMBED',
    });
  });

  it('walks dependencies AND embeds together', async () => {
    const getItem = mkStore([
      {
        id: 'parent',
        dependencies: ['child'],
        embeds: [{ type: 'offer', ref: 'pseudo-pod://bob/offer-1' }],
      },
      { id: 'child', type: 'task' },
    ]);
    const resolveExternalRef = async (ref) => {
      if (ref === 'pseudo-pod://bob/offer-1') {
        return { item: { id: 'offer-1', type: 'offer', body: 'ladder' } };
      }
      return null;
    };
    const tree = await treeOf({ rootId: 'parent', getItem, resolveExternalRef });
    expect(tree.subtasks).toHaveLength(1);
    expect(tree.embeds).toHaveLength(1);
    expect(tree.subtasks[0].id).toBe('child');
    expect(tree.embeds[0].id).toBe('offer-1');
  });
});
