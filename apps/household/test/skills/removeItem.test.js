import { describe, it, expect, beforeEach } from 'vitest';
import { removeItem } from '../../src/skills/removeItem.js';
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

describe('skills/removeItem', () => {
  /** @type {InMemoryStore} */
  let store;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('happy path: removes the matched item and emits item.removed', async () => {
    const item = await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await removeItem({ match: 'bread' }, makeCtx(store));

    expect(reply.replies[0].text).toBe('✓ removed: bread');
    expect(reply.stateUpdates).toEqual([
      { kind: 'item.removed', itemId: item.id, chatId: 'chat-test' },
    ]);
    expect(await store.getById(item.id)).toBeNull();
  });

  it('happy path: id-prefix match removes the item', async () => {
    const item = await store.addItem({ type: 'errand', text: 'pickup', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await removeItem({ match: item.id.slice(0, 8) }, makeCtx(store));
    expect(reply.stateUpdates[0].itemId).toBe(item.id);
    expect(await store.getById(item.id)).toBeNull();
  });

  it('error path: no match → friendly reply, removes nothing', async () => {
    await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await removeItem({ match: 'banana' }, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/Couldn't find/i);
    expect(reply.stateUpdates).toEqual([]);
    expect(await store.listOpen()).toHaveLength(1);
  });

  it('boundary: ambiguous match → returns candidates, removes nothing', async () => {
    await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'shopping', text: 'sourdough bread', addedBy: 'x', source: SAMPLE_SOURCE });

    const reply = await removeItem({ match: 'bread' }, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/Multiple matches/i);
    expect(reply.stateUpdates).toEqual([]);
    expect(await store.listOpen()).toHaveLength(2);
  });

  it('error path: missing match arg → friendly reply, no throw', async () => {
    const reply = await removeItem({}, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/no match keyword/i);
    expect(reply.stateUpdates).toEqual([]);
  });
});
