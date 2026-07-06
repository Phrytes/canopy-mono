import { describe, it, expect, vi } from 'vitest';
import { kringChatMessageEvent, broadcastKringFanOut, classifyFanOut } from '../src/kringBroadcast.js';

const mapOf = () => {
  const m = new Map();
  return { set: (id, s) => (s == null ? m.delete(id) : m.set(id, s)), get: (id) => m.get(id) ?? null, _m: m };
};

describe('kringChatMessageEvent', () => {
  it('builds the canonical kring chat-message event', () => {
    expect(kringChatMessageEvent({ msgId: 'm1', ts: 7, circleId: 'c', actor: 'me', text: 'hi' })).toEqual({
      id: 'm1', ts: 7, app: 'kring', type: 'chat-message', actor: 'me',
      payload: { circleId: 'c', text: 'hi', kind: 'chat-message' },
    });
  });
  it('includes buttons only when present', () => {
    const withBtns = kringChatMessageEvent({ msgId: 'm', ts: 1, circleId: 'c', actor: 'bot', text: 't', buttons: [{ id: 'a', label: 'A' }] });
    expect(withBtns.payload.buttons).toEqual([{ id: 'a', label: 'A' }]);
    expect(kringChatMessageEvent({ msgId: 'm', ts: 1, circleId: 'c', actor: 'bot', text: 't', buttons: [] }).payload).not.toHaveProperty('buttons');
  });
});

describe('broadcastKringFanOut', () => {
  const base = { circleId: 'c1', msgId: 'm1', text: 'hi', ts: 9 };

  it('pending → sent on a clean result, and calls the RAW app-targeted skill', async () => {
    const map = mapOf();
    const calls = [];
    const rawCallSkill = vi.fn(async (app, op, args) => { calls.push([app, op, args]); return {}; });
    const onChange = vi.fn();
    await broadcastKringFanOut({ ...base, rawCallSkill, deliveryStateMap: map, onChange });
    expect(calls[0]).toEqual(['stoop', 'broadcastKringMessage', { groupId: 'c1', text: 'hi', msgId: 'm1', ts: 9 }]);
    expect(map.get('m1')).toBe('sent');
    expect(onChange).toHaveBeenCalledTimes(2);   // pending + sent
  });

  it('pending → undeliverable when every error is permanent (recipient-pubkey-unknown)', async () => {
    const map = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: async () => ({ sent: 0, errors: [{ webid: 'x', reason: 'recipient-pubkey-unknown' }] }), deliveryStateMap: map });
    expect(map.get('m1')).toBe('undeliverable');   // retry can't help → no retry affordance
  });

  it('pending → failed when at least one error is transient (retryable)', async () => {
    const map = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: async () => ({ sent: 0, errors: [
      { webid: 'x', reason: 'recipient-pubkey-unknown' },   // permanent
      { webid: 'y', reason: 'send-timeout' },               // transient → whole fan-out stays retryable
    ] }), deliveryStateMap: map });
    expect(map.get('m1')).toBe('failed');
  });

  it('pending → failed on an {error} envelope and on a throw', async () => {
    const m1 = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: async () => ({ error: 'nope' }), deliveryStateMap: m1 });
    expect(m1.get('m1')).toBe('failed');
    const m2 = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: async () => { throw new Error('boom'); }, deliveryStateMap: m2 });
    expect(m2.get('m1')).toBe('failed');
  });

  it('is a no-op when rawCallSkill is missing (never marks pending)', async () => {
    const map = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: null, deliveryStateMap: map });
    expect(map.get('m1')).toBeNull();
  });
});

describe('classifyFanOut', () => {
  it('no errors → sent', () => {
    expect(classifyFanOut({})).toBe('sent');
    expect(classifyFanOut({ sent: 3, errors: [] })).toBe('sent');
  });
  it('whole-op {error} → failed (transient)', () => {
    expect(classifyFanOut({ error: 'chat-unavailable' })).toBe('failed');
  });
  it('all-permanent recipient errors → undeliverable', () => {
    expect(classifyFanOut({ sent: 0, errors: [
      { webid: 'a', reason: 'recipient-pubkey-unknown' },
      { webid: 'b', reason: 'recipient-pubkey-unknown' },
    ] })).toBe('undeliverable');
  });
  it('any transient recipient error → failed', () => {
    expect(classifyFanOut({ sent: 1, errors: [
      { webid: 'a', reason: 'recipient-pubkey-unknown' },
      { webid: 'b', reason: 'send-timeout' },
    ] })).toBe('failed');
    expect(classifyFanOut({ errors: [{ webid: 'a', reason: 'offline' }] })).toBe('failed');
  });
});
