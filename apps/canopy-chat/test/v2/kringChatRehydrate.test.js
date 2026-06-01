import { describe, it, expect, vi } from 'vitest';
import { rehydrateKringChatsFromStoop } from '../../src/v2/kringChatRehydrate.js';

function fakeEventLog() {
  const events = [];
  return { events, append: (e) => { events.push(e); } };
}

function item(over = {}) {
  return {
    id:    over.id ?? `it-${over.msgId ?? 'x'}`,
    type:  'kring-chat-message',
    text:  over.text ?? 'hello',
    source: {
      circleId:  over.circleId ?? 'g1',
      msgId:     over.msgId    ?? 'm1',
      ts:        over.ts       ?? 1735_000_000_000,
      fromActor: over.fromActor ?? 'webid:anne',
      ...over.source,
    },
  };
}

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };

describe('rehydrateKringChatsFromStoop · SP-13.2.2 boot rehydrator', () => {
  it('returns an error shape when callSkill is missing', async () => {
    const r = await rehydrateKringChatsFromStoop({
      eventLog: fakeEventLog(), logger: silentLogger,
    });
    expect(r.error).toMatch(/callSkill/);
    expect(r.rehydrated).toBe(0);
  });

  it('returns an error shape when eventLog.append is missing', async () => {
    const r = await rehydrateKringChatsFromStoop({
      callSkill: async () => ({ items: [] }),
      logger: silentLogger,
    });
    expect(r.error).toMatch(/eventLog/);
  });

  it('projects each item into a chat-message event with the right shape', async () => {
    const eventLog = fakeEventLog();
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'mA', text: 'first',  ts: 100 }),
      item({ msgId: 'mB', text: 'second', ts: 200 }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, eventLog, logger: silentLogger });

    expect(callSkill).toHaveBeenCalledWith('stoop', 'listKringChats', expect.any(Object));
    expect(r.rehydrated).toBe(2);
    expect(eventLog.events).toHaveLength(2);
    expect(eventLog.events[0].id).toBe('mA');
    expect(eventLog.events[0].app).toBe('kring');
    expect(eventLog.events[0].type).toBe('chat-message');
    expect(eventLog.events[0].ts).toBe(100);
    expect(eventLog.events[0].actor).toBe('webid:anne');
    expect(eventLog.events[0].payload).toMatchObject({
      circleId: 'g1', text: 'first', kind: 'chat-message',
    });
  });

  it('passes groupId / sinceTs / limit through to the skill', async () => {
    const callSkill = vi.fn(async () => ({ items: [] }));
    await rehydrateKringChatsFromStoop({
      callSkill, eventLog: fakeEventLog(),
      groupId: 'oosterpoort', sinceTs: 999, limit: 50, logger: silentLogger,
    });
    expect(callSkill.mock.calls[0][2]).toEqual({
      groupId: 'oosterpoort', sinceTs: 999, limit: 50,
    });
  });

  it('skips items already in the shared dedup set + populates dedup on append', async () => {
    const eventLog = fakeEventLog();
    const dedup = new Set(['mA']);
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'mA' }),
      item({ msgId: 'mB' }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, eventLog, dedup, logger: silentLogger });
    expect(r.rehydrated).toBe(1);
    expect(r.skipped).toBe(1);
    expect(dedup.has('mB')).toBe(true);
    expect(eventLog.events.map((e) => e.id)).toEqual(['mB']);
  });

  it('drops malformed items (counts them in skipped)', async () => {
    const eventLog = fakeEventLog();
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'ok' }),
      { id: 'bad-no-source', type: 'kring-chat-message', text: 'oops' },                    // no source
      { id: 'bad-no-text',   type: 'kring-chat-message', source: { circleId: 'g', msgId: 'x', ts: 1 } }, // no text
      item({ msgId: '',  text: 'bad msgId' }),
      item({ circleId: '', msgId: 'no-circle' }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, eventLog, logger: silentLogger });
    expect(r.rehydrated).toBe(1);
    expect(r.skipped).toBe(4);
    expect(eventLog.events).toHaveLength(1);
  });

  it('returns an error shape on callSkill failure without throwing', async () => {
    const callSkill = vi.fn(async () => { throw new Error('callSkill down'); });
    const r = await rehydrateKringChatsFromStoop({
      callSkill, eventLog: fakeEventLog(),
      logger: { warn: () => {}, info: () => {}, debug: () => {} },
    });
    expect(r.error).toBe('callSkill down');
    expect(r.rehydrated).toBe(0);
  });

  it('handles an empty result without appending anything', async () => {
    const eventLog = fakeEventLog();
    const callSkill = vi.fn(async () => ({ items: [] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, eventLog, logger: silentLogger });
    expect(r.rehydrated).toBe(0);
    expect(eventLog.events).toHaveLength(0);
  });

  /* ── ε.1 — inbox routing ── */

  it('routes through the inbox with source: rehydrator when an inbox is provided', async () => {
    const inboxCalls = [];
    const inbox = {
      ingestChatMessage: vi.fn(async (env, opts) => {
        inboxCalls.push({ env, opts });
        return { result: 'inserted' };
      }),
    };
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'mA', text: 'a', ts: 1 }),
      item({ msgId: 'mB', text: 'b', ts: 2 }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger: silentLogger });
    expect(r.rehydrated).toBe(2);
    expect(inbox.ingestChatMessage).toHaveBeenCalledTimes(2);
    expect(inboxCalls[0].opts.source).toBe('rehydrator');
    expect(inboxCalls[0].env).toMatchObject({
      subtype:  'kring-chat-message',
      circleId: 'g1',
      msgId:    'mA',
      text:     'a',
      ts:       1,
    });
  });

  it('counts inbox-deduped items as skipped (not rehydrated)', async () => {
    const inbox = {
      ingestChatMessage: vi.fn(async () => ({ result: 'deduped' })),
    };
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'mA' }), item({ msgId: 'mB' }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger: silentLogger });
    expect(r.rehydrated).toBe(0);
    expect(r.skipped).toBe(2);
  });

  it('shares dedup state with the receiver through the inbox LRU', async () => {
    // Real inbox; both rehydrator + receiver use it → second arrival is deduped.
    const { createChatMessageInbox } = await import('../../src/v2/chatMessageInbox.js');
    const { makeKringChatPeerHandler } = await import('../../src/v2/kringChatReceiver.js');
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const callSkill = vi.fn(async () => ({ items: [ item({ msgId: 'mShared', text: 'rehydrated' }) ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger: silentLogger });
    expect(r.rehydrated).toBe(1);
    const handler = makeKringChatPeerHandler({ inbox, logger: silentLogger });
    await handler('nkn-addr', {
      subtype: 'kring-chat-message', circleId: 'g1', msgId: 'mShared',
      text: 'live', ts: 9999, fromActor: 'webid:anne',
    });
    expect(eventLog.events).toHaveLength(1);
    expect(eventLog.events[0].payload.text).toBe('rehydrated');
  });
});
