import { describe, it, expect, beforeEach } from 'vitest';
import { nudgeCompletion } from '../../src/skills/nudgeCompletion.js';
import { InMemoryStore } from '../../src/storage/InMemoryStore.js';

const SAMPLE_SOURCE = { tg: { chatId: 'c', messageId: 'm' } };

function makeCtx(store) {
  return {
    store,
    chatId: 'chat-test',
    senderWebid: 'webid:bot',
    bridgeId: 'mock',
  };
}

describe('skills/nudgeCompletion', () => {
  /** @type {InMemoryStore} */
  let store;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('empty store → empty reply (caller can skip posting silently)', async () => {
    const reply = await nudgeCompletion({ chatId: 'chat-test' }, makeCtx(store));
    expect(reply.replies).toEqual([]);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('single open item → friendly prompt + one [✓ done] button keyed by item id', async () => {
    const item = await store.addItem({
      type: 'shopping',
      text: 'bread',
      addedBy: 'webid:alice',
      source: SAMPLE_SOURCE,
    });

    const reply = await nudgeCompletion({ chatId: 'chat-test' }, makeCtx(store));

    expect(reply.replies).toHaveLength(1);
    expect(reply.replies[0].text).toMatch(/^Hi — anything done from the open list\?/);
    expect(reply.replies[0].text).toContain('bread');
    expect(reply.replies[0].text).toContain('(shopping)');
    expect(reply.replies[0].buttons).toHaveLength(1);
    expect(reply.replies[0].buttons[0].id).toBe(item.id);
    expect(reply.replies[0].buttons[0].label).toBe('✓ done');
    expect(reply.stateUpdates).toEqual([]);
  });

  it('mixed-type items render grouped in canonical order (shopping → errand → repair → schedule)', async () => {
    // Add in deliberately-scrambled order to verify the skill re-orders.
    await store.addItem({ type: 'schedule', text: 'dentist',     addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'shopping', text: 'bread',       addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'repair',   text: 'kitchen tap', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'errand',   text: 'post office', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'shopping', text: 'milk',        addedBy: 'x', source: SAMPLE_SOURCE });

    const reply = await nudgeCompletion({ chatId: 'chat-test' }, makeCtx(store));
    const text = reply.replies[0].text;

    const idxBread    = text.indexOf('bread');
    const idxMilk     = text.indexOf('milk');
    const idxPost     = text.indexOf('post office');
    const idxRepair   = text.indexOf('kitchen tap');
    const idxDentist  = text.indexOf('dentist');

    // Each shopping item appears before each errand item, etc.
    expect(idxBread).toBeGreaterThan(-1);
    expect(idxMilk).toBeGreaterThan(-1);
    expect(idxPost).toBeGreaterThan(-1);
    expect(idxRepair).toBeGreaterThan(-1);
    expect(idxDentist).toBeGreaterThan(-1);

    expect(idxBread).toBeLessThan(idxPost);
    expect(idxMilk).toBeLessThan(idxPost);
    expect(idxPost).toBeLessThan(idxRepair);
    expect(idxRepair).toBeLessThan(idxDentist);

    // Buttons present (5 items ≤ 10).
    expect(reply.replies[0].buttons).toHaveLength(5);
  });

  it('>10 items → buttons omitted, plain list rendered', async () => {
    for (let i = 0; i < 11; i++) {
      await store.addItem({
        type: 'shopping',
        text: `item-${i}`,
        addedBy: 'x',
        source: SAMPLE_SOURCE,
      });
    }

    const reply = await nudgeCompletion({ chatId: 'chat-test' }, makeCtx(store));
    expect(reply.replies[0].buttons).toBeUndefined();
    expect(reply.replies[0].text).toContain('item-0');
    expect(reply.replies[0].text).toContain('item-10');
  });

  it('args.itemIds narrows the result; unknown ids are skipped silently', async () => {
    const a = await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    const b = await store.addItem({ type: 'shopping', text: 'milk',  addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'shopping', text: 'eggs', addedBy: 'x', source: SAMPLE_SOURCE });

    const reply = await nudgeCompletion(
      { chatId: 'chat-test', itemIds: [a.id, 'does-not-exist', b.id] },
      makeCtx(store),
    );

    expect(reply.replies).toHaveLength(1);
    expect(reply.replies[0].text).toContain('bread');
    expect(reply.replies[0].text).toContain('milk');
    expect(reply.replies[0].text).not.toContain('eggs');
    expect(reply.replies[0].buttons).toHaveLength(2);
    expect(reply.replies[0].buttons.map((b) => b.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('items completed since the trigger fired are excluded even when supplied via itemIds', async () => {
    const a = await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    const b = await store.addItem({ type: 'shopping', text: 'milk',  addedBy: 'x', source: SAMPLE_SOURCE });
    await store.markComplete(a.id);

    const reply = await nudgeCompletion(
      { chatId: 'chat-test', itemIds: [a.id, b.id] },
      makeCtx(store),
    );

    expect(reply.replies).toHaveLength(1);
    expect(reply.replies[0].text).not.toContain('bread');
    expect(reply.replies[0].text).toContain('milk');
    expect(reply.replies[0].buttons).toHaveLength(1);
    expect(reply.replies[0].buttons[0].id).toBe(b.id);
  });

  it('all supplied itemIds completed → empty reply (caller skips posting)', async () => {
    const a = await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.markComplete(a.id);

    const reply = await nudgeCompletion(
      { chatId: 'chat-test', itemIds: [a.id] },
      makeCtx(store),
    );

    expect(reply.replies).toEqual([]);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('completed items in the store are not surfaced when itemIds is omitted', async () => {
    const a = await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'shopping', text: 'milk', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.markComplete(a.id);

    const reply = await nudgeCompletion({ chatId: 'chat-test' }, makeCtx(store));
    expect(reply.replies[0].text).not.toContain('bread');
    expect(reply.replies[0].text).toContain('milk');
  });

  it('emits no stateUpdates regardless of input', async () => {
    await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await nudgeCompletion({ chatId: 'chat-test' }, makeCtx(store));
    expect(reply.stateUpdates).toEqual([]);
  });
});
