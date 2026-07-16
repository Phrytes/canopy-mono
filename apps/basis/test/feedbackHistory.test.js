// Feedback-thread chat-history persistence — restore the transcript on reload (device-local only).
import { describe, it, expect } from 'vitest';
import { createFeedbackHistoryStore, HISTORY_CAP } from '../src/feedback/feedbackHistory.js';

// Async in-memory adapter (mirrors AsyncStorage). Exercises the await path; the store awaits either way,
// so a sync localStorage-shaped adapter works too.
function memStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    _m: m,
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
  };
}

describe('feedbackHistory', () => {
  it('round-trips save → load (same thread key)', async () => {
    const store = createFeedbackHistoryStore({ storage: memStore() });
    const msgs = [
      { id: 'a1', origin: 'bot', text: 'Welkom', buttons: [{ id: 'fp:report', action: 'fp:report', label: 'Report' }] },
      { id: 'a2', origin: 'user', text: 'Hoi' },
      { id: 'a3', origin: 'bot', kind: 'review', intro: 'Nagekeken:', points: [{ id: 'p1', text: 'punt' }], labels: { original: 'Origineel' } },
    ];
    await store.save('t1', msgs);
    expect(await store.load('t1')).toEqual(msgs);
    // isolated per thread
    expect(await store.load('t2')).toEqual([]);
  });

  it('persists ONLY whitelisted fields — strips functions / surface / DOM refs', async () => {
    const storage = memStore();
    const store = createFeedbackHistoryStore({ storage });
    const dirty = {
      id: 'x1', origin: 'bot', text: 'hi', kind: 'report', logText: 'log',
      // must NOT be persisted:
      onTap: () => 'boom',
      surface: { tapButton: () => {}, live: true },
      mount: {},
      transientFlag: true,
    };
    await store.save('t', [dirty]);
    const loaded = await store.load('t');
    expect(loaded).toEqual([{ id: 'x1', origin: 'bot', text: 'hi', kind: 'report', logText: 'log' }]);
    // and the raw stored blob contains none of the stripped keys
    const raw = storage._m.get('fp.history.t');
    expect(raw).not.toMatch(/onTap|surface|tapButton|transientFlag|mount/);
  });

  it('survives a message holding a circular / non-serializable ref (skips it, keeps the rest)', async () => {
    const store = createFeedbackHistoryStore({ storage: memStore() });
    const circular = { id: 'bad', origin: 'bot', text: 'ref', buttons: [] };
    circular.buttons.push({ self: circular });   // circular ref inside a whitelisted field → unserializable
    const good = { id: 'ok', origin: 'user', text: 'fine' };
    await store.save('t', [circular, good]);
    const loaded = await store.load('t');
    expect(loaded).toEqual([{ id: 'ok', origin: 'user', text: 'fine' }]);
  });

  it('caps stored history to the most recent HISTORY_CAP (201 → newest 200)', async () => {
    const store = createFeedbackHistoryStore({ storage: memStore() });
    const many = Array.from({ length: HISTORY_CAP + 1 }, (_, i) => ({ id: `m${i}`, origin: 'user', text: String(i) }));
    await store.save('t', many);
    const loaded = await store.load('t');
    expect(loaded.length).toBe(HISTORY_CAP);
    expect(loaded[0].id).toBe('m1');                      // oldest (m0) dropped
    expect(loaded[loaded.length - 1].id).toBe(`m${HISTORY_CAP}`);   // newest kept
  });

  it('malformed / absent stored JSON → [] (never throws)', async () => {
    const bad = createFeedbackHistoryStore({ storage: memStore({ 'fp.history.t': '{not json' }) });
    expect(await bad.load('t')).toEqual([]);
    const notArray = createFeedbackHistoryStore({ storage: memStore({ 'fp.history.t': '{"a":1}' }) });
    expect(await notArray.load('t')).toEqual([]);
    const absent = createFeedbackHistoryStore({ storage: memStore() });
    expect(await absent.load('missing')).toEqual([]);
  });

  it('requires a storage adapter', () => {
    expect(() => createFeedbackHistoryStore({})).toThrow();
    expect(() => createFeedbackHistoryStore({ storage: {} })).toThrow();
  });
});
