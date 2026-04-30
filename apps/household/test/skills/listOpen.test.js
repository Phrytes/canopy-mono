import { describe, it, expect, beforeEach } from 'vitest';
import { listOpen } from '../../src/skills/listOpen.js';
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

describe('skills/listOpen', () => {
  /** @type {InMemoryStore} */
  let store;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('happy path: numbered list with mark-done buttons for ≤10 items', async () => {
    await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'shopping', text: 'milk',  addedBy: 'x', source: SAMPLE_SOURCE });

    const reply = await listOpen({ type: 'shopping' }, makeCtx(store));

    expect(reply.replies).toHaveLength(1);
    expect(reply.replies[0].text).toMatch(/^shopping:\n1\. bread\n2\. milk$/);
    expect(reply.replies[0].buttons).toHaveLength(2);
    expect(reply.replies[0].buttons[0].label).toBe('✓ bread');
    expect(reply.replies[0].buttons[1].label).toBe('✓ milk');
    expect(reply.replies[0].buttons[0].id).toMatch(/^done /);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('boundary: empty list returns "Nothing open" message', async () => {
    const reply = await listOpen({ type: 'shopping' }, makeCtx(store));
    expect(reply.replies[0].text).toBe('Nothing open in shopping.');
    expect(reply.replies[0].buttons).toBeUndefined();
  });

  it('omits buttons when list is larger than 10', async () => {
    for (let i = 0; i < 11; i++) {
      await store.addItem({
        type: 'shopping', text: `item-${i}`,
        addedBy: 'x', source: SAMPLE_SOURCE,
      });
    }
    const reply = await listOpen({ type: 'shopping' }, makeCtx(store));
    expect(reply.replies[0].buttons).toBeUndefined();
    expect(reply.replies[0].text).toContain('1. item-0');
    expect(reply.replies[0].text).toContain('11. item-10');
  });

  it('error path: unknown type returns a friendly reply (no throw)', async () => {
    const reply = await listOpen({ type: 'nonsense' }, makeCtx(store));
    expect(reply.replies[0].text).toMatch(/unknown type/i);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('without a type, lists across types', async () => {
    await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'errand',   text: 'post',   addedBy: 'x', source: SAMPLE_SOURCE });

    const reply = await listOpen({}, makeCtx(store));
    expect(reply.replies[0].text).toContain('bread');
    expect(reply.replies[0].text).toContain('post');
  });

  it('does not include completed items', async () => {
    const a = await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'shopping', text: 'milk', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.markComplete(a.id);

    const reply = await listOpen({ type: 'shopping' }, makeCtx(store));
    expect(reply.replies[0].text).not.toContain('bread');
    expect(reply.replies[0].text).toContain('milk');
  });
});
