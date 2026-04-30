import { describe, it, expect, beforeEach } from 'vitest';
import { addItem } from '../../src/skills/addItem.js';
import { InMemoryStore } from '../../src/storage/InMemoryStore.js';

function makeCtx(store) {
  return {
    store,
    chatId: 'chat-test',
    senderWebid: 'webid:alice',
    bridgeId: 'mock',
  };
}

describe('skills/addItem', () => {
  /** @type {InMemoryStore} */
  let store;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('happy path: adds the item and returns the right reply + stateUpdate', async () => {
    const reply = await addItem({ type: 'shopping', text: 'bread' }, makeCtx(store));

    expect(reply.replies).toHaveLength(1);
    expect(reply.replies[0].text).toBe('✓ added to shopping: bread');

    expect(reply.stateUpdates).toHaveLength(1);
    expect(reply.stateUpdates[0].kind).toBe('item.added');
    expect(reply.stateUpdates[0].chatId).toBe('chat-test');
    expect(typeof reply.stateUpdates[0].itemId).toBe('string');

    const open = await store.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0].text).toBe('bread');
    expect(open[0].addedBy).toBe('webid:alice');
    expect(open[0].source.tg.chatId).toBe('chat-test');
  });

  it('trims whitespace in text', async () => {
    const reply = await addItem({ type: 'shopping', text: '  milk  ' }, makeCtx(store));
    expect(reply.replies[0].text).toBe('✓ added to shopping: milk');
    const open = await store.listOpen();
    expect(open[0].text).toBe('milk');
  });

  it('rejects unknown types with a friendly error reply (no throw)', async () => {
    const reply = await addItem({ type: 'nonsense', text: 'x' }, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/unknown type/i);
    expect(reply.stateUpdates).toEqual([]);
    expect(await store.listOpen()).toHaveLength(0);
  });

  it('rejects empty text', async () => {
    const reply = await addItem({ type: 'shopping', text: '   ' }, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/empty/i);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('rejects missing args without throwing', async () => {
    const reply = await addItem({}, makeCtx(store));
    expect(reply.stateUpdates).toEqual([]);
    expect(reply.replies[0].text).toMatch(/unknown type|empty/i);
  });
});
