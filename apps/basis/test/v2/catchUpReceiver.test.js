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
      fromPeerAddr: 'nkn-Bob',
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
      fromPeerAddr: 'nkn-Bob',
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

/* ─────────────────────────────────────────────────────────────────────── */
/* ε.6 — multi-offer chooser hook                                         */
/* ─────────────────────────────────────────────────────────────────────── */

describe('makeCatchUpReceiver · ε.6 chooser hook', () => {
  it('prompt mode with N=1 offer still calls chooseOffer (substrate decision)', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const inbox = fakeInbox();
    const chooseOffer = vi.fn(async (offers, ctx) => ({
      accept: { offerFrom: offers[0].from, mode: 'all' },
    }));

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox,
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      getChooserMode: () => 'prompt',
      chooseOffer,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['nkn-Alice'], fromPeerAddr: 'nkn-Bob',
    });
    await Promise.resolve();
    const requestId = sent[0].env.requestId;

    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-offer', msgId: 'o', ts: 1,
      requestId, count: 2, sizeBytes: 200, lastTs: 1001,
    });
    vi.advanceTimersByTime(80);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(chooseOffer).toHaveBeenCalledTimes(1);
    expect(chooseOffer.mock.calls[0][0]).toHaveLength(1);
    expect(chooseOffer.mock.calls[0][1]).toEqual({ circleId: 'g1' });

    // Settle the request so the test cleans up.
    await onPeerMessage('nkn-Alice', {
      subtype: 'catch-up-end', msgId: 'e', ts: 2, requestId, totalSent: 0,
    });
    await pending;
    vi.useRealTimers();
  });

  it('prompt mode with N=3 offers passes all 3 to chooseOffer', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const inbox = fakeInbox();
    const chooseOffer = vi.fn(async (offers) => ({
      accept: { offerFrom: offers[2].from, mode: 'last-50' },
    }));

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox,
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      getChooserMode: () => 'prompt',
      chooseOffer,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['A', 'B', 'C'], fromPeerAddr: 'me',
    });
    await Promise.resolve();
    const requestId = sent.find((s) => s.env.subtype === 'catch-up-request').env.requestId;

    for (const from of ['A', 'B', 'C']) {
      await onPeerMessage(from, {
        subtype: 'catch-up-offer', msgId: `o-${from}`, ts: 1,
        requestId, count: 10, sizeBytes: 1000, lastTs: 2000,
      });
    }
    vi.advanceTimersByTime(80);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(chooseOffer).toHaveBeenCalledTimes(1);
    const passedOffers = chooseOffer.mock.calls[0][0];
    expect(passedOffers).toHaveLength(3);
    expect(passedOffers.map((o) => o.from).sort()).toEqual(['A', 'B', 'C']);

    // The accept envelope was sent to C with mode 'last-50'.
    const accept = sent.find((s) => s.env.subtype === 'catch-up-accept');
    expect(accept).toBeTruthy();
    expect(accept.addr).toBe('C');
    expect(accept.env.mode).toBe('last-50');

    await onPeerMessage('C', {
      subtype: 'catch-up-end', msgId: 'e', ts: 3, requestId, totalSent: 0,
    });
    await pending;
    vi.useRealTimers();
  });

  it("chooseOffer returns {decline:true} — no accept sent, source='declined'", async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const inbox = fakeInbox();
    const chooseOffer = vi.fn(async () => ({ decline: true }));
    const statuses = [];

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox,
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      getChooserMode: () => 'prompt',
      chooseOffer,
      emitStatus: (s) => statuses.push(s),
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['A', 'B'], fromPeerAddr: 'me',
    });
    await Promise.resolve();
    const requestId = sent.find((s) => s.env.subtype === 'catch-up-request').env.requestId;

    await onPeerMessage('A', {
      subtype: 'catch-up-offer', msgId: 'oA', ts: 1, requestId,
      count: 5, sizeBytes: 500, lastTs: 1000,
    });
    await onPeerMessage('B', {
      subtype: 'catch-up-offer', msgId: 'oB', ts: 2, requestId,
      count: 3, sizeBytes: 300, lastTs: 800,
    });
    vi.advanceTimersByTime(80);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    const r = await pending;
    expect(r.accepted).toBe(false);
    expect(r.source).toBe('declined');
    expect(r.count).toBe(0);
    // No accept envelope sent.
    expect(sent.find((s) => s.env.subtype === 'catch-up-accept')).toBeUndefined();
    // 'declined' phase emitted.
    expect(statuses.map((s) => s.phase)).toContain('declined');
    vi.useRealTimers();
  });

  it('chooseOffer returns null → same as decline', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const chooseOffer = vi.fn(async () => null);

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox: fakeInbox(),
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      getChooserMode: () => 'prompt',
      chooseOffer,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['A'], fromPeerAddr: 'me',
    });
    await Promise.resolve();
    const requestId = sent.find((s) => s.env.subtype === 'catch-up-request').env.requestId;

    await onPeerMessage('A', {
      subtype: 'catch-up-offer', msgId: 'oA', ts: 1, requestId,
      count: 1, sizeBytes: 50, lastTs: 100,
    });
    vi.advanceTimersByTime(80);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    const r = await pending;
    expect(r.source).toBe('declined');
    expect(sent.find((s) => s.env.subtype === 'catch-up-accept')).toBeUndefined();
    vi.useRealTimers();
  });

  it('chooseOffer rejection is treated as decline (clean state)', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const chooseOffer = vi.fn(async () => { throw new Error('user closed app'); });
    const warns = [];
    const logger = { ...silentLogger, warn: (...a) => warns.push(a) };

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox: fakeInbox(),
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      getChooserMode: () => 'prompt',
      chooseOffer,
      makeId: stableMakeId, logger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['A'], fromPeerAddr: 'me',
    });
    await Promise.resolve();
    const requestId = sent.find((s) => s.env.subtype === 'catch-up-request').env.requestId;

    await onPeerMessage('A', {
      subtype: 'catch-up-offer', msgId: 'oA', ts: 1, requestId,
      count: 1, sizeBytes: 50, lastTs: 100,
    });
    vi.advanceTimersByTime(80);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    const r = await pending;
    expect(r.source).toBe('declined');
    expect(r.accepted).toBe(false);
    expect(sent.find((s) => s.env.subtype === 'catch-up-accept')).toBeUndefined();
    // The rejection was logged.
    expect(warns.some((args) => String(args[0]).includes('chooseOffer threw'))).toBe(true);
    vi.useRealTimers();
  });

  it("accept envelope carries the chooser's mode", async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const chooseOffer = vi.fn(async (offers) => ({
      accept: { offerFrom: offers[0].from, mode: 'last-7-days' },
    }));

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox: fakeInbox(),
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      getChooserMode: () => 'prompt',
      chooseOffer,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['A'], fromPeerAddr: 'me',
    });
    await Promise.resolve();
    const requestId = sent.find((s) => s.env.subtype === 'catch-up-request').env.requestId;

    await onPeerMessage('A', {
      subtype: 'catch-up-offer', msgId: 'oA', ts: 1, requestId,
      count: 1, sizeBytes: 50, lastTs: 100,
    });
    vi.advanceTimersByTime(80);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    const accept = sent.find((s) => s.env.subtype === 'catch-up-accept');
    expect(accept).toBeTruthy();
    expect(accept.env.mode).toBe('last-7-days');

    await onPeerMessage('A', {
      subtype: 'catch-up-end', msgId: 'e', ts: 3, requestId, totalSent: 0,
    });
    await pending;
    vi.useRealTimers();
  });

  it('slow chooser (8s) — chunk-timeout restarts AFTER accept is sent', async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const inbox = fakeInbox();
    // Resolve after 8000 ms.  We'll drive the timer by hand.
    const chooseOffer = vi.fn((offers) => new Promise((resolve) => {
      setTimeout(() => resolve({ accept: { offerFrom: offers[0].from, mode: 'all' } }), 8000);
    }));

    // chunkTimeoutMs is SHORTER than the chooser delay.  In the OLD
    // first-offer-wins code the chunk timer would have been armed at
    // offer-window-elapsed, and 5000 ms of "thinking" would have made
    // it fire.  Under ε.6 the timer starts at accept-send so the user
    // has the full chunkTimeoutMs to receive chunks AFTER accepting.
    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox,
      offerWindowMs: 50, chunkTimeoutMs: 5000,
      getChooserMode: () => 'prompt',
      chooseOffer,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['A'], fromPeerAddr: 'me',
    });
    await Promise.resolve();
    const requestId = sent.find((s) => s.env.subtype === 'catch-up-request').env.requestId;

    await onPeerMessage('A', {
      subtype: 'catch-up-offer', msgId: 'oA', ts: 1, requestId,
      count: 1, sizeBytes: 50, lastTs: 100,
    });
    vi.advanceTimersByTime(80);  // past offer window
    for (let i = 0; i < 3; i += 1) await Promise.resolve();

    // No accept yet — chooser is still pending.
    expect(sent.find((s) => s.env.subtype === 'catch-up-accept')).toBeUndefined();

    // Advance the chooser's 8s wait.  The chunk timer should NOT have
    // fired because it wasn't armed yet.
    vi.advanceTimersByTime(8000);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    // Accept was sent after the chooser resolved.
    expect(sent.find((s) => s.env.subtype === 'catch-up-accept')).toBeTruthy();

    // Now drive a chunk + end so the request settles cleanly.
    await onPeerMessage('A', {
      subtype: 'catch-up-chunk', msgId: 'c', ts: 9000, requestId,
      seq: 0, items: [mkItem(0, 100)], finished: true,
    });
    await onPeerMessage('A', {
      subtype: 'catch-up-end', msgId: 'e', ts: 9001, requestId, totalSent: 1,
    });
    const r = await pending;
    expect(r.source).toBe('streamed');
    expect(r.count).toBe(1);
    vi.useRealTimers();
  });

  it("'auto' mode (default) never calls chooseOffer — regression-safe", async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const chooseOffer = vi.fn(async () => ({ decline: true }));

    // Two ways to get 'auto': omit getChooserMode entirely, OR have it
    // return 'auto'.  Verify both behave the same.
    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox: fakeInbox(),
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      // NO getChooserMode here.
      chooseOffer,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['A', 'B'], fromPeerAddr: 'me',
    });
    await Promise.resolve();
    const requestId = sent.find((s) => s.env.subtype === 'catch-up-request').env.requestId;

    await onPeerMessage('A', {
      subtype: 'catch-up-offer', msgId: 'oA', ts: 1, requestId,
      count: 5, sizeBytes: 500, lastTs: 1000,
    });
    await onPeerMessage('B', {
      subtype: 'catch-up-offer', msgId: 'oB', ts: 2, requestId,
      count: 3, sizeBytes: 300, lastTs: 800,
    });
    vi.advanceTimersByTime(80);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(chooseOffer).not.toHaveBeenCalled();
    // First offer was accepted — to A, mode 'all'.
    const accept = sent.find((s) => s.env.subtype === 'catch-up-accept');
    expect(accept.addr).toBe('A');
    expect(accept.env.mode).toBe('all');

    await onPeerMessage('A', {
      subtype: 'catch-up-end', msgId: 'e', ts: 3, requestId, totalSent: 0,
    });
    await pending;
    vi.useRealTimers();
  });

  it("getChooserMode returning 'auto' explicitly also takes the legacy path", async () => {
    vi.useFakeTimers();
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const chooseOffer = vi.fn(async () => ({ decline: true }));

    const { requestCatchUp, onPeerMessage } = makeCatchUpReceiver({
      sendToPeer, inbox: fakeInbox(),
      offerWindowMs: 50, chunkTimeoutMs: 1000,
      getChooserMode: () => 'auto',
      chooseOffer,
      makeId: stableMakeId, logger: silentLogger,
    });
    const pending = requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['A'], fromPeerAddr: 'me',
    });
    await Promise.resolve();
    const requestId = sent.find((s) => s.env.subtype === 'catch-up-request').env.requestId;

    await onPeerMessage('A', {
      subtype: 'catch-up-offer', msgId: 'oA', ts: 1, requestId,
      count: 1, sizeBytes: 50, lastTs: 100,
    });
    vi.advanceTimersByTime(80);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(chooseOffer).not.toHaveBeenCalled();
    expect(sent.find((s) => s.env.subtype === 'catch-up-accept')).toBeTruthy();

    await onPeerMessage('A', {
      subtype: 'catch-up-end', msgId: 'e', ts: 3, requestId, totalSent: 0,
    });
    await pending;
    vi.useRealTimers();
  });
});
