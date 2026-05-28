import { describe, it, expect, beforeEach } from 'vitest';
import { briefSummary } from '../../src/skills/briefSummary.js';
import { InMemoryStore } from '../../src/storage/InMemoryStore.js';

const SAMPLE_SOURCE = { tg: { chatId: 'c', messageId: 'm' } };

function makeCtx(store) {
  return {
    store,
    chatId:       'chat-test',
    senderWebid:  'webid:alice',
    bridgeId:     'mock',
  };
}

describe('skills/briefSummary — Q30 contributor', () => {
  /** @type {InMemoryStore} */
  let store;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('returns {ok: true} when no open items (brief.js skips the section)', async () => {
    const reply = await briefSummary({}, makeCtx(store));
    expect(reply.replies).toHaveLength(1);
    expect(reply.replies[0]).toEqual({ ok: true });
    expect(reply.stateUpdates).toEqual([]);
  });

  it('returns items[] + a count message when open items exist', async () => {
    await store.addItem({ type: 'shopping', text: 'bread', addedBy: 'x', source: SAMPLE_SOURCE });
    await store.addItem({ type: 'errand',   text: 'pick up dry-cleaning', addedBy: 'x', source: SAMPLE_SOURCE });

    const reply = await briefSummary({}, makeCtx(store));
    expect(reply.replies).toHaveLength(1);
    const payload = reply.replies[0];
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].label).toBe('bread');
    expect(payload.items[1].label).toBe('pick up dry-cleaning');
    expect(payload.items[0].id).toBeTruthy();
    expect(payload.message).toBe('2 open household items');
    expect(reply.stateUpdates).toEqual([]);
  });

  it('singular message when exactly one open item', async () => {
    await store.addItem({ type: 'shopping', text: 'milk', addedBy: 'x', source: SAMPLE_SOURCE });
    const reply = await briefSummary({}, makeCtx(store));
    expect(reply.replies[0].message).toBe('1 open household item');
  });

  it('caps items[] at 5 even when more are open', async () => {
    for (let i = 0; i < 8; i++) {
      await store.addItem({
        type: 'shopping', text: `item-${i}`,
        addedBy: 'x', source: SAMPLE_SOURCE,
      });
    }
    const reply = await briefSummary({}, makeCtx(store));
    expect(reply.replies[0].items).toHaveLength(5);
    expect(reply.replies[0].message).toBe('8 open household items');
  });
});
