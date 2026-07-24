/**
 * basis — EventLog substrate tests.  v0.7.1.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  EventLog, RETENTION_MS, SYSTEM_APP,
  makeSilentEntry, isSilentEntry, shouldWakeForEntry,
} from '../src/eventLog.js';
import { EventRouter } from '../src/events.js';
import { ThreadStore } from '../src/threadStore.js';

const ev = (over = {}) => ({
  id: `e-${Math.random().toString(36).slice(2, 8)}`,
  ts: Date.now(),
  app: 'household',
  type: 'item-changed',
  payload: { message: 'hi' },
  ...over,
});

/**
 * Tests use small synthetic timestamps; we disable retention via
 * Infinity so events with ts:1000 don't get instantly pruned (they'd
 * be > 14 days old vs. real Date.now()).  The dedicated "prune"
 * test above sets a tight retention to exercise the prune path.
 */
const noPrune = () => ({ retentionMs: Infinity });

describe('EventLog — append + prune', () => {
  it("appends most-recent first", () => {
    const log = new EventLog(noPrune());
    log.append(ev({ id: '1', ts: 1000 }));
    log.append(ev({ id: '2', ts: 2000 }));
    log.append(ev({ id: '3', ts: 3000 }));
    expect(log.query().map((e) => e.id)).toEqual(['3', '2', '1']);
  });

  it("de-duplicates on id (re-append overwrites)", () => {
    const log = new EventLog(noPrune());
    log.append(ev({ id: '1', ts: 1000, payload: { message: 'v1' } }));
    log.append(ev({ id: '1', ts: 2000, payload: { message: 'v2' } }));
    expect(log.size).toBe(1);
    expect(log.query()[0].payload.message).toBe('v2');
  });

  it("ignores events with no id", () => {
    const log = new EventLog(noPrune());
    log.append({ ts: 1, app: 'x', type: 'y' });
    log.append({ id: '', ts: 1, app: 'x', type: 'y' });
    expect(log.size).toBe(0);
  });

  it("ignores null / non-object input", () => {
    const log = new EventLog(noPrune());
    log.append(null);
    log.append(undefined);
    log.append('not an event');
    expect(log.size).toBe(0);
  });

  it("prunes events older than retentionMs on every append", () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retentionMs: 1000 });
    log.append(ev({ id: 'old', ts: 0 }));
    clock = 2000;
    log.append(ev({ id: 'new', ts: 2000 }));
    expect(log.size).toBe(1);
    expect(log.query()[0].id).toBe('new');
  });

  it("default retention is 14 days", () => {
    expect(RETENTION_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("prune() returns the count of pruned events", () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retentionMs: 1000 });
    log.append(ev({ id: 'a', ts: 0 }));
    log.append(ev({ id: 'b', ts: 100 }));
    log.append(ev({ id: 'c', ts: 200 }));
    clock = 1500;
    expect(log.prune()).toBe(3);
    expect(log.size).toBe(0);
  });
});

describe('EventLog — query', () => {
  const seed = () => {
    const log = new EventLog(noPrune());
    log.append(ev({ id: '1', ts: 1000, app: 'household', type: 'item-changed', actor: 'webid:anne' }));
    log.append(ev({ id: '2', ts: 2000, app: 'stoop',     type: 'notification', actor: 'webid:karl' }));
    log.append(ev({ id: '3', ts: 3000, app: 'household', type: 'notification', actor: 'webid:anne' }));
    log.append(ev({ id: '4', ts: 4000, app: 'tasks',  type: 'item-changed', actor: 'webid:maria' }));
    return log;
  };

  it("no filter → all events, most-recent first", () => {
    expect(seed().query().map((e) => e.id)).toEqual(['4', '3', '2', '1']);
  });

  it("flat filter — apps + eventTypes AND", () => {
    const r = seed().query({
      filter: { apps: ['household'], eventTypes: ['notification'] },
    });
    expect(r.map((e) => e.id)).toEqual(['3']);
  });

  it("expression-tree filter — OR of apps", () => {
    const r = seed().query({
      filter: { or: [{ apps: ['stoop'] }, { apps: ['tasks'] }] },
    });
    expect(r.map((e) => e.id)).toEqual(['4', '2']);
  });

  it("since cutoff", () => {
    const r = seed().query({ since: 2500 });
    expect(r.map((e) => e.id)).toEqual(['4', '3']);
  });

  it("until cutoff", () => {
    const r = seed().query({ until: 2500 });
    expect(r.map((e) => e.id)).toEqual(['2', '1']);
  });

  it("limit", () => {
    const r = seed().query({ limit: 2 });
    expect(r.length).toBe(2);
    expect(r[0].id).toBe('4');
  });

  it("excludeMuted respects mute() set", () => {
    const log = seed();
    log.mute('household', 'notification');
    const all     = log.query({ excludeMuted: false });
    const visible = log.query({ excludeMuted: true });
    expect(all.length).toBe(4);
    expect(visible.map((e) => e.id)).toEqual(['4', '2', '1']);
  });
});

describe('EventLog — mute set', () => {
  it("mute / unmute / isMuted", () => {
    const log = new EventLog();
    expect(log.isMuted('h', 't')).toBe(false);
    expect(log.mute('h', 't')).toBe(true);
    expect(log.isMuted('h', 't')).toBe(true);
    expect(log.mute('h', 't')).toBe(false);   // idempotent
    expect(log.unmute('h', 't')).toBe(true);
    expect(log.isMuted('h', 't')).toBe(false);
  });

  it("mutedList returns sorted snapshot", () => {
    const log = new EventLog();
    log.mute('z', 'b'); log.mute('a', 'a'); log.mute('m', 'c');
    expect(log.mutedList()).toEqual(['a:a', 'm:c', 'z:b']);
  });

  it("setMutedPersistor fires on mute/unmute", async () => {
    const log = new EventLog(noPrune());
    const saves = [];
    log.setMutedPersistor((m) => { saves.push(m.slice()); });
    log.mute('h', 't');
    log.mute('s', 'n');
    log.unmute('h', 't');
    expect(saves.length).toBe(3);
    expect(saves[2]).toEqual(['s:n']);
  });

  it("initial muted set hydrates from constructor", () => {
    const log = new EventLog({ muted: ['a:a', 'b:b'] });
    expect(log.isMuted('a', 'a')).toBe(true);
    expect(log.isMuted('b', 'b')).toBe(true);
  });
});

describe('EventLog — subscribe', () => {
  it("fires on every append", () => {
    const log = new EventLog();
    const seen = [];
    const off = log.subscribe((e) => seen.push(e.id));
    log.append(ev({ id: '1' }));
    log.append(ev({ id: '2' }));
    off();
    log.append(ev({ id: '3' }));
    expect(seen).toEqual(['1', '2']);
  });
});

describe('EventLog — initial hydration + persist', () => {
  it("hydrates from initial array", () => {
    const log = new EventLog({
      initial: [ev({ id: 'a', ts: 1 }), ev({ id: 'b', ts: 2 })],
    });
    expect(log.size).toBe(2);
  });

  it("persists on append (async; doesn't await)", async () => {
    const saves = [];
    const log = new EventLog({
      persist: async (events) => { saves.push(events.length); },
    });
    log.append(ev({ id: '1' }));
    log.append(ev({ id: '2' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(saves.length).toBe(2);
    expect(saves[1]).toBe(2);
  });
});

describe('EventLog.attachToRouter', () => {
  it("logs every event the EventRouter delivers", () => {
    const store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main' });
    const router = new EventRouter({ threadStore: store });
    const log = new EventLog();
    log.attachToRouter(router);
    router.deliver({ id: 'e1', app: 'household', type: 'item-changed', payload: {} });
    router.deliver({ id: 'e2', app: 'stoop',     type: 'notification', payload: {} });
    expect(log.query().map((e) => e.id)).toEqual(['e2', 'e1']);
  });

  it("logs even events that no thread filter matches", () => {
    const store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main', filter: { apps: ['ONLY-this'] } });
    const router = new EventRouter({ threadStore: store });
    const log = new EventLog();
    log.attachToRouter(router);
    const matched = router.deliver({
      id: 'unrouted', app: 'household', type: 'foo', payload: {},
    });
    expect(matched).toEqual([]);   // no thread matched
    expect(log.size).toBe(1);      // still logged
  });

  it("attachToRouter returns an unsubscribe handle", () => {
    const store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main' });
    const router = new EventRouter({ threadStore: store });
    const log = new EventLog();
    const off = log.attachToRouter(router);
    router.deliver({ id: 'e1', app: 'h', type: 'x', payload: {} });
    off();
    router.deliver({ id: 'e2', app: 'h', type: 'x', payload: {} });
    expect(log.size).toBe(1);
  });

  it("rejects non-router input", () => {
    expect(() => new EventLog().attachToRouter(null)).toThrow();
    expect(() => new EventLog().attachToRouter({})).toThrow();
  });
});

describe('EventLog — C15 silent system-entry lane', () => {
  it('appendSilentEntry logs a typed entry with a first-class circleId + silent marker', () => {
    const log = new EventLog(noPrune());
    const entry = log.appendSilentEntry({ circleId: 'circle-1', kind: 'membership-changed', payload: { who: 'ann' }, ts: 1000 });
    expect(entry.app).toBe(SYSTEM_APP);
    expect(entry.type).toBe('membership-changed');
    expect(entry.circleId).toBe('circle-1');   // first-class scope
    expect(entry.silent).toBe(true);
    expect(typeof entry.id).toBe('string');
    // It IS logged (the Stream firehose reads it) — appendSilentEntry rides append().
    expect(log.query().map((e) => e.id)).toEqual([entry.id]);
    expect(log.query()[0].payload).toEqual({ who: 'ann' });
  });

  it('makeSilentEntry is pure + generates an id/ts when omitted', () => {
    const a = makeSilentEntry({ circleId: 'c', kind: 'k' });
    expect(a.silent).toBe(true);
    expect(a.app).toBe(SYSTEM_APP);
    expect(typeof a.id).toBe('string');
    expect(typeof a.ts).toBe('number');
  });

  it('isSilentEntry discriminates silent entries from chat messages', () => {
    const silent = makeSilentEntry({ circleId: 'c', kind: 'k' });
    const chat = { id: 'm1', ts: 1, app: 'kring', type: 'chat-message', payload: { circleId: 'c', text: 'hi' } };
    expect(isSilentEntry(silent)).toBe(true);
    expect(isSilentEntry(chat)).toBe(false);
    expect(isSilentEntry(null)).toBe(false);
    expect(isSilentEntry({})).toBe(false);
  });

  it('shouldWakeForEntry: silent → false, a chat message → true', () => {
    const silent = makeSilentEntry({ circleId: 'c', kind: 'k' });
    const chat = { id: 'm1', ts: 1, app: 'kring', type: 'chat-message', payload: { circleId: 'c', text: 'hi' } };
    expect(shouldWakeForEntry(silent)).toBe(false);
    expect(shouldWakeForEntry(chat)).toBe(true);
    expect(shouldWakeForEntry(null)).toBe(false);
  });
});
