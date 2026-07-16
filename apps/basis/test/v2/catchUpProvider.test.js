/**
 * ε.4 — catchUpProvider tests.
 *
 * Drives the provider through:
 *   - auto-approve happy path (offer + chunks + end)
 *   - no-items silent path (no envelopes sent)
 *   - mode-aware filter (last-50 / last-7-days)
 *   - chunk splitting at custom chunkSize
 *   - manual approval path (autoApprove=false + unknown contact)
 *     → emitNotification fires, request pends, host calls
 *       resolveCatchUpRequest, stream proceeds.
 *   - decline path (resolveCatchUpRequest with mode: null → no
 *     envelopes sent).
 *   - malformed request → silent drop.
 *   - callSkill throws → silent drop (no envelopes sent).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCatchUpProviderHandler } from '../../src/v2/catchUpProvider.js';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function mkRequest(over = {}) {
  return {
    subtype: 'catch-up-request',
    msgId: 'r1', ts: 1,
    groupId: 'g1', sinceTs: 0, requestId: 'cu-1', fromPeerAddr: 'nkn-Alice',
    ...over,
  };
}

function mkChatItem(i, ts) {
  return {
    subtype: 'kring-chat-message',
    circleId: 'g1',
    msgId: `m${i}`,
    ts,
    text: `msg-${i}`,
    fromActor: 'webid:bob',
  };
}

describe('makeCatchUpProviderHandler · auto-approve path', () => {
  it('sends offer then streams chunks + end after accept', async () => {
    const items = Array.from({ length: 3 }, (_, i) => mkChatItem(i, 1000 + i));
    const callSkill = vi.fn(async (origin, op) => {
      if (op === 'getMessagesSince') return { items, truncated: false };
      return null;
    });
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });

    const { handler, onAccept } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, logger: silentLogger,
    });

    // 1) Request → offer sent, then waits for accept.
    await handler('nkn-Alice', mkRequest());

    expect(callSkill).toHaveBeenCalledWith('stoop', 'getMessagesSince', {
      groupId: 'g1', sinceTs: 0, max: 1000,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].env.subtype).toBe('catch-up-offer');
    expect(sent[0].env.requestId).toBe('cu-1');
    expect(sent[0].env.count).toBe(3);
    expect(sent[0].env.lastTs).toBe(1002);

    // 2) Receiver accepts; provider streams chunk + end.
    await onAccept('nkn-Alice', {
      subtype: 'catch-up-accept', msgId: 'a', ts: 1,
      requestId: 'cu-1', mode: 'all',
    });
    expect(sent).toHaveLength(3);
    expect(sent[1].env.subtype).toBe('catch-up-chunk');
    expect(sent[1].env.items).toHaveLength(3);
    expect(sent[1].env.finished).toBe(true);
    expect(sent[2].env.subtype).toBe('catch-up-end');
    expect(sent[2].env.totalSent).toBe(3);
  });

  it('falls back to payload.fromPeerAddr if router from is missing', async () => {
    const items = [mkChatItem(0, 100)];
    const callSkill = vi.fn(async () => ({ items }));
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push({ addr, env }); });
    const { handler } = makeCatchUpProviderHandler({ callSkill, sendToPeer, logger: silentLogger });

    await handler(null, mkRequest({ fromPeerAddr: 'nkn-Bob' }));

    // Offer goes to nkn-Bob (from payload, since router 'from' was null).
    expect(sent[0].addr).toBe('nkn-Bob');
  });

  it('SILENT (no envelopes) when count === 0', async () => {
    const callSkill = vi.fn(async () => ({ items: [], truncated: false }));
    const sendToPeer = vi.fn(async () => {});
    const { handler } = makeCatchUpProviderHandler({ callSkill, sendToPeer, logger: silentLogger });

    await handler('nkn-Alice', mkRequest());

    expect(sendToPeer).not.toHaveBeenCalled();
  });

  it('splits into multiple chunks at custom chunkSize (after accept)', async () => {
    const items = Array.from({ length: 7 }, (_, i) => mkChatItem(i, 1000 + i));
    const callSkill = vi.fn(async () => ({ items }));
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push(env); });
    const { handler, onAccept } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, chunkSize: 3, logger: silentLogger,
    });

    await handler('nkn-Alice', mkRequest());
    await onAccept('nkn-Alice', {
      subtype: 'catch-up-accept', msgId: 'a', ts: 1,
      requestId: 'cu-1', mode: 'all',
    });
    // offer + 3 chunks + end
    expect(sent.filter((e) => e.subtype === 'catch-up-chunk')).toHaveLength(3);
    expect(sent.filter((e) => e.subtype === 'catch-up-chunk').map((e) => e.items.length))
      .toEqual([3, 3, 1]);
    // last chunk finished=true, others false
    const chunks = sent.filter((e) => e.subtype === 'catch-up-chunk');
    expect(chunks[0].finished).toBe(false);
    expect(chunks[1].finished).toBe(false);
    expect(chunks[2].finished).toBe(true);
    expect(sent.find((e) => e.subtype === 'catch-up-end').totalSent).toBe(7);
  });

  it('SILENT on malformed request', async () => {
    const callSkill = vi.fn();
    const sendToPeer = vi.fn();
    const { handler } = makeCatchUpProviderHandler({ callSkill, sendToPeer, logger: silentLogger });

    await handler('nkn-x', { subtype: 'catch-up-request', requestId: '' });
    expect(callSkill).not.toHaveBeenCalled();
    expect(sendToPeer).not.toHaveBeenCalled();
  });

  it('SILENT when callSkill throws', async () => {
    const callSkill = vi.fn(async () => { throw new Error('boom'); });
    const sendToPeer = vi.fn();
    const { handler } = makeCatchUpProviderHandler({ callSkill, sendToPeer, logger: silentLogger });

    await handler('nkn-Alice', mkRequest());
    expect(sendToPeer).not.toHaveBeenCalled();
  });

  it('continues stream + still sends catch-up-end when a chunk send fails midway', async () => {
    const items = Array.from({ length: 5 }, (_, i) => mkChatItem(i, 1000 + i));
    const callSkill = vi.fn(async () => ({ items }));
    let calls = 0;
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => {
      calls += 1;
      // Offer OK; after accept, first chunk OK, second chunk FAILS, then end OK.
      if (calls === 3) throw new Error('chunk failed');
      sent.push(env);
    });
    const { handler, onAccept } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, chunkSize: 2, logger: silentLogger,
    });

    await handler('nkn-Alice', mkRequest());
    await onAccept('nkn-Alice', {
      subtype: 'catch-up-accept', msgId: 'a', ts: 1,
      requestId: 'cu-1', mode: 'all',
    });

    // offer + first chunk + end (third call was the failing chunk;
    // fourth call is catch-up-end)
    const subs = sent.map((e) => e.subtype);
    expect(subs).toContain('catch-up-offer');
    expect(subs).toContain('catch-up-end');
    // totalSent reflects only the chunks that were successfully sent
    const end = sent.find((e) => e.subtype === 'catch-up-end');
    expect(end.totalSent).toBeLessThan(5);
  });
});

describe('makeCatchUpProviderHandler · mode filter', () => {
  it("'last-50' filter trims to tail when accepted manually", async () => {
    const items = Array.from({ length: 80 }, (_, i) => mkChatItem(i, 1000 + i));
    const callSkill = vi.fn(async () => ({ items }));
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push(env); });
    const notif = vi.fn();
    const { handler, resolveCatchUpRequest } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, logger: silentLogger,
      isKnownContact: () => false,
      getCirclePolicy: () => ({ catchUpAutoApprove: false }),
      emitNotification: notif,
    });
    await handler('nkn-Alice', mkRequest());
    expect(notif).toHaveBeenCalledTimes(1);
    // Host UI picks last-50.
    await resolveCatchUpRequest({ requestId: 'cu-1', mode: 'last-50' });
    const offer = sent.find((e) => e.subtype === 'catch-up-offer');
    expect(offer.count).toBe(50);
    const chunks = sent.filter((e) => e.subtype === 'catch-up-chunk');
    const totalChunkItems = chunks.reduce((a, c) => a + c.items.length, 0);
    expect(totalChunkItems).toBe(50);
  });
});

describe('makeCatchUpProviderHandler · manual approval', () => {
  it('emitNotification fires for autoApprove=false + unknown contact', async () => {
    const items = Array.from({ length: 3 }, (_, i) => mkChatItem(i, 1000 + i));
    const callSkill = vi.fn(async () => ({ items }));
    const sendToPeer = vi.fn(async () => {});
    const notif = vi.fn();
    const { handler, _pending } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, logger: silentLogger,
      isKnownContact: () => false,
      getCirclePolicy: () => ({ catchUpAutoApprove: false }),
      emitNotification: notif,
    });
    await handler('nkn-Alice', mkRequest());
    expect(notif).toHaveBeenCalledTimes(1);
    // No envelopes sent yet.
    expect(sendToPeer).not.toHaveBeenCalled();
    // Pending entry exists.
    expect(_pending.has('cu-1')).toBe(true);
    // Notification carries the preview.
    const n = notif.mock.calls[0][0];
    expect(n.requestId).toBe('cu-1');
    expect(n.fromPeerAddr).toBe('nkn-Alice');
    expect(n.count).toBe(3);
    expect(n.modeOptions).toContain('all');
    expect(n.modeOptions).toContain(null);
  });

  it('resolveCatchUpRequest with mode=all streams the response', async () => {
    const items = [mkChatItem(0, 1000)];
    const callSkill = vi.fn(async () => ({ items }));
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push(env); });
    const { handler, resolveCatchUpRequest } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, logger: silentLogger,
      isKnownContact: () => false,
      getCirclePolicy: () => ({ catchUpAutoApprove: false }),
      emitNotification: () => {},
    });
    await handler('nkn-Alice', mkRequest());
    expect(sendToPeer).not.toHaveBeenCalled();

    await resolveCatchUpRequest({ requestId: 'cu-1', mode: 'all' });
    expect(sent.some((e) => e.subtype === 'catch-up-offer')).toBe(true);
    expect(sent.some((e) => e.subtype === 'catch-up-end')).toBe(true);
  });

  it('resolveCatchUpRequest with mode=null declines silently', async () => {
    const items = [mkChatItem(0, 1000)];
    const callSkill = vi.fn(async () => ({ items }));
    const sendToPeer = vi.fn(async () => {});
    const { handler, resolveCatchUpRequest, _pending } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, logger: silentLogger,
      isKnownContact: () => false,
      getCirclePolicy: () => ({ catchUpAutoApprove: false }),
      emitNotification: () => {},
    });
    await handler('nkn-Alice', mkRequest());
    await resolveCatchUpRequest({ requestId: 'cu-1', mode: null });
    expect(sendToPeer).not.toHaveBeenCalled();
    expect(_pending.has('cu-1')).toBe(false);
  });

  it('known contact auto-approves even when policy.catchUpAutoApprove=false', async () => {
    const items = [mkChatItem(0, 1000)];
    const callSkill = vi.fn(async () => ({ items }));
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push(env); });
    const notif = vi.fn();
    const { handler } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, logger: silentLogger,
      isKnownContact: () => true,
      getCirclePolicy: () => ({ catchUpAutoApprove: false }),
      emitNotification: notif,
    });
    await handler('nkn-Alice', mkRequest());
    expect(notif).not.toHaveBeenCalled();
    expect(sent.some((e) => e.subtype === 'catch-up-offer')).toBe(true);
  });

  it('policy.catchUpAutoApprove undefined defaults to auto-approve (V1 default)', async () => {
    const items = [mkChatItem(0, 1000)];
    const callSkill = vi.fn(async () => ({ items }));
    const sent = [];
    const sendToPeer = vi.fn(async (addr, env) => { sent.push(env); });
    const { handler } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, logger: silentLogger,
      isKnownContact: () => false,
      getCirclePolicy: () => ({}),     // no axis
      emitNotification: () => {},
    });
    await handler('nkn-Alice', mkRequest());
    expect(sent.some((e) => e.subtype === 'catch-up-offer')).toBe(true);
  });

  it('decision timer evicts a forgotten pending entry', async () => {
    vi.useFakeTimers();
    const items = [mkChatItem(0, 1000)];
    const callSkill = vi.fn(async () => ({ items }));
    const sendToPeer = vi.fn(async () => {});
    const { handler, _pending } = makeCatchUpProviderHandler({
      callSkill, sendToPeer, logger: silentLogger,
      isKnownContact: () => false,
      getCirclePolicy: () => ({ catchUpAutoApprove: false }),
      emitNotification: () => {},
      decisionTimeoutMs: 100,
    });
    await handler('nkn-Alice', mkRequest());
    expect(_pending.has('cu-1')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(_pending.has('cu-1')).toBe(false);
    vi.useRealTimers();
  });
});

describe('makeCatchUpProviderHandler · construction', () => {
  it('throws when callSkill is missing', () => {
    expect(() => makeCatchUpProviderHandler({ sendToPeer: () => {} })).toThrow(/callSkill/);
  });
  it('throws when sendToPeer is missing', () => {
    expect(() => makeCatchUpProviderHandler({ callSkill: () => {} })).toThrow(/sendToPeer/);
  });
});
