/**
 * ε.4 — catchUpReceiver tests.
 *
 * Drives the coordinator through:
 *   - single offer within window → first-accepted, chunks ingested
 *   - multiple offers in window → first-accepted, others ignored
 *   - no offers within window → resolves no-offers
 *   - chunk timeout while ACCEPTED → resolves chunk-timeout
 *   - duplicate chunk (same seq) → deduped
 *   - chunks from wrong peer → ignored
 *   - inbox dedupe counts as deduped (not inserted)
 *   - in-flight de-dupe: same (circleId, sinceTs) gets de-duped
 *   - no peers → resolves no-peers without sending
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCatchUpReceiver } from '../../src/v2/catchUpReceiver.js';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function fakeInbox({ dedupe = false } = {}) {
  const calls = [];
  return {
    calls,
    async ingestChatMessage(env, opts) {
      calls.push({ env, opts });
      if (dedupe) return { result: 'deduped' };
      return { result: 'inserted' };
    },
  };
}

function mkItem(i, ts) {
  return {
    subtype: 'kring-chat-message',
    circleId: 'g1',
    msgId: `m${i}`,
    ts,
    text: `t-${i}`,
    fromActor: 'webid:x',
  };
}

let _counter = 0;
const stableMakeId = () => `cu-test-${++_counter}`;

describe('makeCatchUpReceiver · happy path', () => {
  it('single offer + chunks + end → inserted', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const inbox = fakeInbox();
    const statuses = [];

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox,
      offerWindowMs: 100,
      chunkTimeoutMs: 1000,
      emitStatus: (s) => statuses.push(s),
      makeId: stableMakeId,
      logger: silentLogger,
    });

    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: [{ addr: 'nkn-Alice' }],
      fromNknAddr: 'nkn-Bob',
    });

    // Wait microtask so the broadcast fires.
    await Promise.resolve();
    expect(sent[0].addr).toBe('nkn-Alice');
    expect(sent[0].env.subtype).toBe('catch-up-request');
    const requestId = sent[0].env.requestId;

    // Alice replies with an offer.
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-offer', msgId: 'o', ts: 1,
      requestId, count: 2, sizeBytes: 200, lastTs: 1001,
    });

    // Drive the offer window forward.
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();

    // Accept sent.
    expect(sent.find((s) => s.env.subtype === 'catch-up-accept')).toBeTruthy();

    // Alice sends a chunk + end.
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-chunk', msgId: 'c', ts: 2,
      requestId, seq: 0,
      items: [mkItem(0, 1000), mkItem(1, 1001)],
      finished: true,
    });
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-end', msgId: 'e', ts: 3,
      requestId, totalSent: 2,
    });

    const result = await pending;
    expect(result.accepted).toBe(true);
    expect(result.count).toBe(2);
    expect(result.source).toBe('streamed');
    expect(inbox.calls).toHaveLength(2);
    expect(inbox.calls[0].opts.source).toBe('catchUp');

    // Status emitter saw the relevant phases.
    const phases = statuses.map((s) => s.phase);
    expect(phases).toContain('requesting');
    expect(phases).toContain('streaming');
    expect(phases).toContain('done');

    vi.useRealTimers();
  });

  it('multiple offers → first accepted, others ignored', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const inbox = fakeInbox();

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox,
      offerWindowMs: 100, chunkTimeoutMs: 1000,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['nkn-Alice', 'nkn-Carol'],
      fromNknAddr: 'nkn-Bob',
    });

    await Promise.resolve();
    const requestId = sent[0].env.requestId;

    // Both Alice and Carol offer.
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-offer', msgId: 'o1', ts: 1,
      requestId, count: 5, sizeBytes: 500, lastTs: 1000,
    });
    await onPeerMessage('nkn-Carol', {
      subtype: 'catch-up-offer', msgId: 'o2', ts: 2,
      requestId, count: 3, sizeBytes: 300, lastTs: 800,
    });

    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();

    // Accept goes to ALICE only.
    const accepts = sent.filter((s) => s.env.subtype === 'catch-up-accept');
    expect(accepts).toHaveLength(1);
    expect(accepts[0].addr).toBe('nkn-Alice');

    // Chunk from Carol must be dropped.
    await onPeerMessage('nkn-Carol', {
      subtype: 'catch-up-chunk', msgId: 'cC', ts: 3,
      requestId, seq: 0, items: [mkItem(99, 999)], finished: true,
    });
    expect(inbox.calls).toHaveLength(0);

    // Alice's chunk + end finalize.
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-chunk', msgId: 'cA', ts: 4,
      requestId, seq: 0, items: [mkItem(0, 1000)], finished: true,
    });
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-end', msgId: 'eA', ts: 5,
      requestId, totalSent: 1,
    });
    const result = await pending;
    expect(result.count).toBe(1);
    expect(inbox.calls).toHaveLength(1);

    vi.useRealTimers();
  });

  it('no offers within window → resolves no-offers', async () => {
    vi.useFakeTimers();
    const sendToPeer = vi.fn(async () => {});
    const inbox = fakeInbox();
    const { requestCatchUp } = makeCatchUpReceiver({
      sendToPeer, inbox,
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['nkn-Alice'],
    });
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    const r = await pending;
    expect(r.accepted).toBe(false);
    expect(r.source).toBe('no-offers');
    expect(r.count).toBe(0);
    vi.useRealTimers();
  });

  it('chunk timeout → resolves chunk-timeout after accepted', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push(env); });
    const inbox = fakeInbox();
    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox,
      offerWindowMs: 50, chunkTimeoutMs: 200,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['nkn-Alice'],
    });
    await Promise.resolve();
    const requestId = sent[0].requestId;

    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-offer', msgId: 'o', ts: 1,
      requestId, count: 1, sizeBytes: 50, lastTs: 100,
    });
    vi.advanceTimersByTime(100);  // past offer window
    await Promise.resolve();
    await Promise.resolve();

    // No chunks ever arrive — advance past chunkTimeoutMs.
    vi.advanceTimersByTime(300);
    await Promise.resolve();

    const r = await pending;
    expect(r.source).toBe('chunk-timeout');
    expect(r.count).toBe(0);

    vi.useRealTimers();
  });
});

describe('makeCatchUpReceiver · dedupe + edge cases', () => {
  it('duplicate chunks (same seq) are deduped on the way in', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push(env); });
    const inbox = fakeInbox();
    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox, offerWindowMs: 50, chunkTimeoutMs: 1000,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({ circleId: 'g1', sinceTs: 0, knownPeers: ['nkn-Alice'] });
    await Promise.resolve();
    const requestId = sent[0].requestId;
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-offer', msgId: 'o', ts: 1, requestId,
      count: 1, sizeBytes: 50, lastTs: 100,
    });
    vi.advanceTimersByTime(60);
    await Promise.resolve();
    await Promise.resolve();

    // Same chunk delivered twice (NKN reorder / retransmit).
    const chunkEnv = {
      subtype: 'catch-up-chunk', msgId: 'c', ts: 2, requestId, seq: 0,
      items: [mkItem(0, 100)], finished: true,
    };
    await onPeerMessage('nkn-Alice', chunkEnv);
    await onPeerMessage('nkn-Alice', chunkEnv);

    // Only ONE inbox call (dedup on (requestId, seq)).
    expect(inbox.calls).toHaveLength(1);

    await onPeerMessage('nkn-Alice', { subtype: 'catch-up-end', msgId: 'e', ts: 3, requestId, totalSent: 1 });
    const r = await pending;
    expect(r.count).toBe(1);

    vi.useRealTimers();
  });

  it('inbox dedupe counts as deduped, not inserted', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push(env); });
    const inbox = fakeInbox({ dedupe: true });
    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox, offerWindowMs: 50, chunkTimeoutMs: 1000,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({ circleId: 'g1', sinceTs: 0, knownPeers: ['nkn-Alice'] });
    await Promise.resolve();
    const requestId = sent[0].requestId;
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-offer', msgId: 'o', ts: 1, requestId,
      count: 2, sizeBytes: 100, lastTs: 100,
    });
    vi.advanceTimersByTime(60);
    await Promise.resolve();
    await Promise.resolve();

    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-chunk', msgId: 'c', ts: 2, requestId, seq: 0,
      items: [mkItem(0, 100), mkItem(1, 101)], finished: true,
    });
    await onPeerMessage('nkn-Alice', { subtype: 'catch-up-end', msgId: 'e', ts: 3, requestId, totalSent: 2 });

    const r = await pending;
    expect(r.deduped).toBe(2);
    expect(r.inserted).toBe(0);
    expect(r.count).toBe(2);

    vi.useRealTimers();
  });

  it('in-flight de-dupe: same (circleId, sinceTs) is short-circuited', async () => {
    vi.useFakeTimers();
    const sendToPeer = vi.fn(async () => {});
    const inbox = fakeInbox();
    const { requestCatchUp } = makeCatchUpReceiver({
      sendToPeer, inbox, offerWindowMs: 100, chunkTimeoutMs: 500,
      makeId: stableMakeId, logger: silentLogger,
    });
    const p1 = requestCatchUp({ circleId: 'g1', sinceTs: 0, knownPeers: ['nkn-A'] });
    await Promise.resolve();
    const p2 = requestCatchUp({ circleId: 'g1', sinceTs: 0, knownPeers: ['nkn-A'] });
    // p2 should resolve immediately as in-flight.
    const r2 = await p2;
    expect(r2.source).toBe('in-flight');

    // Settle the first one.
    vi.advanceTimersByTime(150);
    await Promise.resolve();
    await p1;
    vi.useRealTimers();
  });

  it('no peers → resolves no-peers, no broadcast', async () => {
    const sendToPeer = vi.fn(async () => {});
    const inbox = fakeInbox();
    const { requestCatchUp } = makeCatchUpReceiver({
      sendToPeer, inbox, makeId: stableMakeId, logger: silentLogger,
    });
    const r = await requestCatchUp({ circleId: 'g1', sinceTs: 0, knownPeers: [] });
    expect(r.source).toBe('no-peers');
    expect(sendToPeer).not.toHaveBeenCalled();
  });

  it('no circleId → resolves no-circleId', async () => {
    const sendToPeer = vi.fn();
    const inbox = fakeInbox();
    const { requestCatchUp } = makeCatchUpReceiver({
      sendToPeer, inbox, logger: silentLogger,
    });
    const r = await requestCatchUp({ circleId: '', knownPeers: ['x'] });
    expect(r.source).toBe('no-circleId');
  });

  it('stale offer (no matching request) is silently ignored', async () => {
    const inbox = fakeInbox();
    const { onPeerMessage } = makeCatchUpReceiver({
      sendToPeer: () => {}, inbox, logger: silentLogger,
    });
    // No-throw on an offer with unknown requestId.
    await onPeerMessage('nkn-X', {
      subtype: 'catch-up-offer', msgId: 'o', ts: 1,
      requestId: 'nope', count: 1, sizeBytes: 1, lastTs: 1,
    });
    expect(inbox.calls).toHaveLength(0);
  });
});

describe('makeCatchUpReceiver · construction', () => {
  it('throws when sendToPeer is missing', () => {
    expect(() => makeCatchUpReceiver({ inbox: fakeInbox() })).toThrow(/sendToPeer/);
  });
  it('throws when inbox is missing', () => {
    expect(() => makeCatchUpReceiver({ sendToPeer: () => {} })).toThrow(/inbox/);
  });
});
