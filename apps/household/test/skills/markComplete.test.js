import { describe, it, expect, beforeEach } from 'vitest';
import { markComplete } from '../../src/skills/markComplete.js';
import { InMemoryStore } from '../../src/storage/InMemoryStore.js';

const SAMPLE_SOURCE = { tg: { chatId: 'c', messageId: 'm' } };

function makeCtx(store) {
  return {
    store,
    chatId: 'chat-test',
    senderWebid: 'webid:alice',
    bridgeId: 'mock',
  };
}

describe('skills/markComplete', () => {
  /** @type {InMemoryStore} */
  let store;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('happy path: text-keyword match completes the item', async () => {
    const item = await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await markComplete({ match: 'bread' }, makeCtx(store));

    expect(reply.replies[0].text).toBe('✓ marked complete: bread');
    expect(reply.stateUpdates).toEqual([
      { kind: 'item.completed', itemId: item.id, chatId: 'chat-test' },
    ]);
    const after = await store.listOpen();
    expect(after).toHaveLength(0);
  });

  it('happy path: id-exact match completes the item', async () => {
    const item = await store.addItem({ type: 'shopping', text: 'milk', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await markComplete({ match: item.id }, makeCtx(store));
    expect(reply.replies[0].text).toContain('milk');
    expect(reply.stateUpdates[0].itemId).toBe(item.id);
  });

  it('happy path: id-prefix match (≥6 chars) completes the item', async () => {
    const item = await store.addItem({ type: 'shopping', text: 'eggs', addedBy: 'x', source: SAMPLE_SOURCE });
    const prefix = item.id.slice(0, 8);
    const reply = await markComplete({ match: prefix }, makeCtx(store));
    expect(reply.replies[0].text).toContain('eggs');
    expect(reply.stateUpdates[0].itemId).toBe(item.id);
  });

  it('error path: no match → friendly reply, no stateUpdate', async () => {
    await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await markComplete({ match: 'banana' }, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/Couldn't find/i);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('boundary: ambiguous match → returns candidates, completes nothing', async () => {
    await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'shopping', text: 'sourdough bread', addedBy: 'x', source: SAMPLE_SOURCE });

    const reply = await markComplete({ match: 'bread' }, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/Multiple matches/i);
    expect(reply.stateUpdates).toEqual([]);

    const open = await store.listOpen();
    expect(open).toHaveLength(2);
  });

  it('error path: missing match arg → friendly reply (no throw)', async () => {
    const reply = await markComplete({}, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/no match keyword/i);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('does not match already-completed items', async () => {
    const a = await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.markComplete(a.id);

    const reply = await markComplete({ match: 'bread' }, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/Couldn't find/i);
  });

  it('match is case-insensitive on text', async () => {
    await store.addItem({ type: 'shopping', text: 'Bread', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await markComplete({ match: 'BREAD' }, makeCtx(store));
    expect(reply.replies[0].text).toContain('Bread');
  });
});
