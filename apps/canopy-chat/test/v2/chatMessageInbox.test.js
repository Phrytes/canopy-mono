import { describe, it, expect, vi } from 'vitest';
import {
  createChatMessageInbox,
  isValidChatEnvelope,
} from '../../src/v2/chatMessageInbox.js';

function fakeEventLog() {
  const events = [];
  return { events, append: (e) => { events.push(e); } };
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

describe('createChatMessageInbox · ε.1 single normalization gate', () => {
  it('throws when eventLog is missing', () => {
    expect(() => createChatMessageInbox({})).toThrow(/eventLog/);
  });

  /* ── validation ── */

  it('returns inserted + appends event on a valid envelope', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope(), { source: 'receiver', fromPeerAddr: 'nkn-anne' });
    expect(r).toEqual({ result: 'inserted' });
    expect(eventLog.events).toHaveLength(1);
    const ev = eventLog.events[0];
    expect(ev.id).toBe('m1');
    expect(ev.ts).toBe(1735_000_000_000);
    expect(ev.app).toBe('kring');
    expect(ev.type).toBe('chat-message');
    expect(ev.actor).toBe('webid:anne');
    expect(ev.payload).toEqual({
      circleId: 'g1',
      text:     'Hoi buurt!',
      kind:     'chat-message',
      senderDisplay: 'webid:anne',
    });
  });

  it('rejects (does not append) on malformed envelopes', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const cases = [
      null,
      { subtype: 'kring-chat-message', circleId: '',  msgId: 'm', text: 't', ts: 1 },
      { subtype: 'kring-chat-message', circleId: 'g', msgId: '',  text: 't', ts: 1 },
      { subtype: 'kring-chat-message', circleId: 'g', msgId: 'm', text: '',  ts: 1 },
      { subtype: 'kring-chat-message', circleId: 'g', msgId: 'm', text: 't', ts: 'x' },
      { subtype: 'something-else',     circleId: 'g', msgId: 'm', text: 't', ts: 1 },
    ];
    for (const c of cases) {
      const r = await inbox.ingestChatMessage(c, { source: 'receiver' });
      expect(r.result).toBe('rejected');
      expect(r.reason).toBe('malformed');
    }
    expect(eventLog.events).toHaveLength(0);
  });

  it('exposes isValidChatEnvelope as a named export', () => {
    expect(isValidChatEnvelope(envelope())).toBe(true);
    expect(isValidChatEnvelope(null)).toBeFalsy();
    expect(isValidChatEnvelope({ ...envelope(), subtype: 'nope' })).toBeFalsy();
  });

  /* ── dedup ── */

  it('returns deduped on second arrival with same msgId — only one append', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const r1 = await inbox.ingestChatMessage(envelope({ msgId: 'mX', text: 'first' }), { source: 'receiver' });
    const r2 = await inbox.ingestChatMessage(envelope({ msgId: 'mX', text: 'second' }), { source: 'receiver' });
    expect(r1.result).toBe('inserted');
    expect(r2.result).toBe('deduped');
    expect(eventLog.events).toHaveLength(1);
    expect(eventLog.events[0].payload.text).toBe('first');
  });

  it('dedupes across sources — receiver then rehydrator with same msgId', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const r1 = await inbox.ingestChatMessage(envelope({ msgId: 'mY' }), { source: 'receiver' });
    const r2 = await inbox.ingestChatMessage(envelope({ msgId: 'mY' }), { source: 'rehydrator' });
    expect(r1.result).toBe('inserted');
    expect(r2.result).toBe('deduped');
    expect(eventLog.events).toHaveLength(1);
  });

  it('dedupes across sources — rehydrator then receiver with same msgId', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const r1 = await inbox.ingestChatMessage(envelope({ msgId: 'mZ' }), { source: 'rehydrator' });
    const r2 = await inbox.ingestChatMessage(envelope({ msgId: 'mZ' }), { source: 'receiver', fromPeerAddr: 'nkn' });
    expect(r1.result).toBe('inserted');
    expect(r2.result).toBe('deduped');
    expect(eventLog.events).toHaveLength(1);
  });

  it('LRU dedup evicts the oldest msgId once cap is exceeded', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, dedupCap: 2, logger: silentLogger });
    await inbox.ingestChatMessage(envelope({ msgId: 'A' }), { source: 'receiver' });
    await inbox.ingestChatMessage(envelope({ msgId: 'B' }), { source: 'receiver' });
    await inbox.ingestChatMessage(envelope({ msgId: 'C' }), { source: 'receiver' });   // evicts A
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'A', text: 'replayed' }), { source: 'receiver' });
    expect(r.result).toBe('inserted');
    expect(eventLog.events.map((e) => e.id)).toEqual(['A', 'B', 'C', 'A']);
  });

  /* ── actor resolution ── */

  it('falls back to fromPeerAddr when payload.fromActor is missing', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    await inbox.ingestChatMessage(
      envelope({ msgId: 'mF', fromActor: null }),
      { source: 'receiver', fromPeerAddr: 'nkn-fallback' },
    );
    expect(eventLog.events[0].actor).toBe('nkn-fallback');
    expect(eventLog.events[0].payload.senderDisplay).toBe('nkn-fallback');
  });

  it('runs the constructor-level resolveActor by default', async () => {
    const eventLog = fakeEventLog();
    const resolveActor = vi.fn(() => 'Anne');
    const inbox = createChatMessageInbox({ eventLog, resolveActor, logger: silentLogger });
    await inbox.ingestChatMessage(envelope({ msgId: 'mR' }), { source: 'receiver', fromPeerAddr: 'nkn' });
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(eventLog.events[0].actor).toBe('Anne');
    expect(eventLog.events[0].payload.senderDisplay).toBe('Anne');
  });

  it('runs the per-call resolveActor when provided (overrides constructor default)', async () => {
    const eventLog = fakeEventLog();
    const ctorActor = vi.fn(() => 'Default');
    const callActor = vi.fn(() => 'PerCall');
    const inbox = createChatMessageInbox({ eventLog, resolveActor: ctorActor, logger: silentLogger });
    await inbox.ingestChatMessage(
      envelope({ msgId: 'mP' }),
      { source: 'receiver', fromPeerAddr: 'nkn', resolveActor: callActor },
    );
    expect(ctorActor).not.toHaveBeenCalled();
    expect(callActor).toHaveBeenCalledTimes(1);
    expect(eventLog.events[0].actor).toBe('PerCall');
  });

  /* ── ingest verdicts ── */

  it('calls ingest first, then appends to eventLog when ingest is OK', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ ok: true, itemId: 'item-1' }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mA' }), { source: 'receiver', fromPeerAddr: 'nkn' });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][0].msgId).toBe('mA');
    expect(ingest.mock.calls[0][1]).toBe('nkn');
    expect(r.result).toBe('inserted');
    expect(eventLog.events).toHaveLength(1);
  });

  it('returns evicted (no append) when ingest reports evicted', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ evicted: true }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mE' }), { source: 'receiver' });
    expect(r.result).toBe('evicted');
    expect(eventLog.events).toHaveLength(0);
  });

  it('returns muted (no append) when ingest reports muted', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ muted: true }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mM' }), { source: 'receiver' });
    expect(r.result).toBe('muted');
    expect(eventLog.events).toHaveLength(0);
  });

  it('returns deduped (no append) when ingest reports already-stored deduped', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ deduped: true }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mD' }), { source: 'receiver' });
    expect(r.result).toBe('deduped');
    expect(eventLog.events).toHaveLength(0);
  });

  it('returns rejected (no append) when ingest returns an error', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ error: 'storage down' }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mErr' }), { source: 'receiver' });
    expect(r.result).toBe('rejected');
    expect(r.reason).toBe('ingest-error');
    expect(eventLog.events).toHaveLength(0);
  });

  it('falls back to local-only append (still inserted) when ingest throws', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => { throw new Error('callSkill down'); });
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mT' }), { source: 'receiver' });
    expect(r.result).toBe('inserted');
    expect(eventLog.events).toHaveLength(1);
  });

  /* ── source tag ── */

  it('passes the source through to the info logger so telemetry can split paths', async () => {
    const eventLog = fakeEventLog();
    const info = vi.fn();
    const inbox = createChatMessageInbox({
      eventLog,
      logger: { warn: () => {}, info, debug: () => {} },
    });
    await inbox.ingestChatMessage(envelope({ msgId: 'mS1' }), { source: 'receiver', fromPeerAddr: 'nkn' });
    await inbox.ingestChatMessage(envelope({ msgId: 'mS2' }), { source: 'rehydrator' });
    const sources = info.mock.calls.map((c) => c.find((s) => typeof s === 'string' && s.startsWith('source=')));
    expect(sources).toEqual(['source=receiver', 'source=rehydrator']);
  });
});
