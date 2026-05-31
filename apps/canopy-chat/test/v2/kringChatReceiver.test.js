import { describe, it, expect, vi } from 'vitest';
import { makeKringChatPeerHandler } from '../../src/v2/kringChatReceiver.js';

function fakeEventLog() {
  const events = [];
  return {
    events,
    append: (e) => { events.push(e); },
  };
}

function envelope(over = {}) {
  return {
    subtype:   'kring-chat-message',
    circleId:  'g1',
    msgId:     'm1',
    text:      'Hoi buurt!',
    ts:        1735_000_000_000,
    fromActor: 'webid:anne',
    ...over,
  };
}

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };

describe('makeKringChatPeerHandler · SP-13.2.1 receiver', () => {
  it('throws when eventLog is missing', () => {
    expect(() => makeKringChatPeerHandler({})).toThrow(/eventLog/);
  });

  it('appends a chat-message event scoped to the circle on a valid envelope', () => {
    const eventLog = fakeEventLog();
    const handler = makeKringChatPeerHandler({ eventLog, logger: silentLogger });
    handler('nkn-addr-of-anne', envelope());
    expect(eventLog.events).toHaveLength(1);
    const ev = eventLog.events[0];
    expect(ev.id).toBe('m1');
    expect(ev.ts).toBe(1735_000_000_000);
    expect(ev.app).toBe('kring');
    expect(ev.type).toBe('chat-message');
    expect(ev.actor).toBe('webid:anne');
    expect(ev.payload.circleId).toBe('g1');
    expect(ev.payload.text).toBe('Hoi buurt!');
    expect(ev.payload.kind).toBe('chat-message');
    expect(ev.payload.senderDisplay).toBe('webid:anne');
  });

  it('falls back to fromNknAddr when payload.fromActor is missing', () => {
    const eventLog = fakeEventLog();
    const handler = makeKringChatPeerHandler({ eventLog, logger: silentLogger });
    handler('nkn-addr', envelope({ fromActor: null }));
    expect(eventLog.events[0].actor).toBe('nkn-addr');
  });

  it('runs resolveActor when supplied (for MemberMap display-name lookup)', () => {
    const eventLog = fakeEventLog();
    const resolveActor = vi.fn(() => 'Anne');
    const handler = makeKringChatPeerHandler({ eventLog, resolveActor, logger: silentLogger });
    handler('nkn-addr', envelope({ fromActor: 'webid:anne' }));
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(eventLog.events[0].actor).toBe('Anne');
    expect(eventLog.events[0].payload.senderDisplay).toBe('Anne');
  });

  it('dedupes by msgId — second envelope with same msgId is a no-op', () => {
    const eventLog = fakeEventLog();
    const handler = makeKringChatPeerHandler({ eventLog, logger: silentLogger });
    handler('nkn-addr', envelope({ msgId: 'm1', text: 'first' }));
    handler('nkn-addr', envelope({ msgId: 'm1', text: 'second' }));
    expect(eventLog.events).toHaveLength(1);
    expect(eventLog.events[0].payload.text).toBe('first');
  });

  it('shares dedup state when caller passes a shared Set', () => {
    const eventLog = fakeEventLog();
    const dedup = new Set();
    const h1 = makeKringChatPeerHandler({ eventLog, dedup, logger: silentLogger });
    const h2 = makeKringChatPeerHandler({ eventLog, dedup, logger: silentLogger });
    h1('a', envelope({ msgId: 'm9' }));
    h2('a', envelope({ msgId: 'm9' }));   // same msgId, different handler → still deduped
    expect(eventLog.events).toHaveLength(1);
  });

  it('drops malformed envelopes silently (no append, warns)', () => {
    const eventLog = fakeEventLog();
    const warn = vi.fn();
    const handler = makeKringChatPeerHandler({ eventLog, logger: { warn, info: () => {}, debug: () => {} } });

    handler('a', null);
    handler('a', { subtype: 'kring-chat-message', circleId: '', msgId: 'm', text: 't', ts: 1 });   // empty circleId
    handler('a', { subtype: 'kring-chat-message', circleId: 'g', msgId: '',  text: 't', ts: 1 });   // empty msgId
    handler('a', { subtype: 'kring-chat-message', circleId: 'g', msgId: 'm', text: '',  ts: 1 });   // empty text
    handler('a', { subtype: 'kring-chat-message', circleId: 'g', msgId: 'm', text: 't', ts: 'x' }); // bad ts
    handler('a', { subtype: 'something-else',    circleId: 'g', msgId: 'm', text: 't', ts: 1 });    // wrong subtype

    expect(eventLog.events).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(6);
  });

  it('LRU dedup evicts oldest msgId once cap is exceeded', () => {
    const eventLog = fakeEventLog();
    const handler = makeKringChatPeerHandler({ eventLog, dedupCap: 2, logger: silentLogger });
    handler('a', envelope({ msgId: 'A' }));
    handler('a', envelope({ msgId: 'B' }));
    handler('a', envelope({ msgId: 'C' }));   // evicts A
    // A is now evictable — replaying it should append again.
    handler('a', envelope({ msgId: 'A', text: 'replayed' }));
    expect(eventLog.events.map((e) => e.id)).toEqual(['A', 'B', 'C', 'A']);
  });

  /* ── Hybrid: ingest mirror (SP-13.2.1 storage layer) ── */

  it('calls ingest first, then appends to eventLog when ingest is OK', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ ok: true, itemId: 'item-1' }));
    const handler = makeKringChatPeerHandler({ eventLog, ingest, logger: silentLogger });
    await handler('nkn-addr', envelope({ msgId: 'mA' }));
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][0].msgId).toBe('mA');
    expect(eventLog.events).toHaveLength(1);
  });

  it('suppresses eventLog append when ingest returns evicted', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ evicted: true }));
    const handler = makeKringChatPeerHandler({ eventLog, ingest, logger: silentLogger });
    await handler('nkn-addr', envelope({ msgId: 'mE' }));
    expect(eventLog.events).toHaveLength(0);
  });

  it('suppresses eventLog append when ingest returns muted', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ muted: true }));
    const handler = makeKringChatPeerHandler({ eventLog, ingest, logger: silentLogger });
    await handler('nkn-addr', envelope({ msgId: 'mM' }));
    expect(eventLog.events).toHaveLength(0);
  });

  it('suppresses eventLog append when ingest returns deduped (already stored)', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ deduped: true }));
    const handler = makeKringChatPeerHandler({ eventLog, ingest, logger: silentLogger });
    await handler('nkn-addr', envelope({ msgId: 'mD' }));
    expect(eventLog.events).toHaveLength(0);
  });

  it('falls back to eventLog-only when ingest throws', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => { throw new Error('callSkill down'); });
    const handler = makeKringChatPeerHandler({
      eventLog, ingest,
      logger: { warn: () => {}, info: () => {}, debug: () => {} },
    });
    await handler('nkn-addr', envelope({ msgId: 'mT' }));
    expect(eventLog.events).toHaveLength(1);
  });
});
