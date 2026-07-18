/**
 * Unit tests for src/core/handlers/catchUp.js.
 *
 * ε.3 (2026-06-01) — added regression coverage for the new strategy-
 * routed entry points: `makePodRangeQueryForGroup` (pod path) and
 * `makeRequestCatchUpForGroup` (per-kring peer path), plus the
 * `getCirclePolicy` + `inbox` deps on `makeRequestCatchUpFromKnownPeers`.
 * The pre-existing slice-5 suite still passes verbatim — default policy
 * `{pod: 'personal'}` ⇒ 'peer' strategy ⇒ bit-for-bit identical to the
 * pre-ε.3 send envelope.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  makeRequestCatchUpFromKnownPeers,
  makeHandleCatchUpRequest,
  makePodRangeQueryForGroup,
  makeRequestCatchUpForGroup,
} from '../../src/core/handlers/catchUp.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('requestCatchUpFromKnownPeers', () => {
  it('iterates every known buurt + sends a catch-up-request to each roster peer', async () => {
    const callSkill = vi.fn(async (_app, op, args) => {
      if (op === 'listMyBuurts')          return { buurts: ['westend', 'noord'] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: args.groupId === 'westend' ? 1000 : 2000 };
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-a' }, { addr: 'addr-b' }] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpFromKnownPeers({ callSkill, sendPeer, logger: silentLogger });

    await fn();
    // 2 buurts × 2 peers = 4 sends
    expect(sendPeer).toHaveBeenCalledTimes(4);
    const envelopes = sendPeer.mock.calls.map((c) => c[1]);
    expect(envelopes.every((e) => e.subtype === 'catch-up-request')).toBe(true);
    // Two distinct sinceMs values, one per buurt
    const westendCalls = sendPeer.mock.calls.filter((c) => c[1].groupId === 'westend');
    expect(westendCalls.every((c) => c[1].sinceMs === 1000)).toBe(true);
  });

  it('skips silently when listMyBuurts fails', async () => {
    const callSkill = vi.fn(async () => { throw new Error('no buurts'); });
    const sendPeer = vi.fn();
    const fn = makeRequestCatchUpFromKnownPeers({ callSkill, sendPeer, logger: silentLogger });
    await fn();
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('skips empty rosters but still iterates next buurt', async () => {
    const callSkill = vi.fn(async (_app, op, args) => {
      if (op === 'listMyBuurts')          return { buurts: ['empty', 'full'] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 0 };
      if (op === 'listGroupRoster')
        return { members: args.groupId === 'full' ? [{ addr: 'addr-a' }] : [] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpFromKnownPeers({ callSkill, sendPeer, logger: silentLogger });
    await fn();
    expect(sendPeer).toHaveBeenCalledTimes(1);
    expect(sendPeer.mock.calls[0][1].groupId).toBe('full');
  });
});

describe('handleCatchUpRequest', () => {
  it('replies with one buurt-post envelope per matching post', async () => {
    const post1 = { requestId: 'r1', text: 'old', from: 'addr-a', type: 'request', _addedAt: 100 };
    const post2 = { requestId: 'r2', text: 'new', from: 'addr-a', type: 'request', _addedAt: 200 };
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listBuurtPostsSince') return { posts: [post1, post2] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeHandleCatchUpRequest({
      callSkill, sendPeer,
      getMyPubKey: () => 'my-pubkey',
      logger: silentLogger,
    });

    await fn('addr-asking', { groupId: 'westend', sinceMs: 50 });
    expect(sendPeer).toHaveBeenCalledTimes(2);
    const envelopes = sendPeer.mock.calls.map((c) => c[1]);
    expect(envelopes.every((e) => e.subtype === 'buurt-post')).toBe(true);
    expect(envelopes.every((e) => e.catchUp === true)).toBe(true);
    expect(envelopes.every((e) => e.groupId === 'westend')).toBe(true);
    // _addedAt is stripped from the inner payload (not sent on the wire).
    expect(envelopes[0].payload._addedAt).toBeUndefined();
    expect(envelopes[0].payload.requestId).toBe('r1');
  });

  it('no-ops when there are zero matching posts', async () => {
    const callSkill = vi.fn(async () => ({ posts: [] }));
    const sendPeer = vi.fn();
    const fn = makeHandleCatchUpRequest({
      callSkill, sendPeer,
      getMyPubKey: () => 'my-pubkey',
      logger: silentLogger,
    });
    await fn('addr-asking', { groupId: 'westend', sinceMs: 0 });
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('continues past a send failure for one post', async () => {
    const callSkill = vi.fn(async () => ({
      posts: [
        { requestId: 'r1', text: 'a', _addedAt: 1 },
        { requestId: 'r2', text: 'b', _addedAt: 2 },
      ],
    }));
    let n = 0;
    const sendPeer = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
    });
    const fn = makeHandleCatchUpRequest({
      callSkill, sendPeer,
      getMyPubKey: () => 'my-pubkey',
      logger: silentLogger,
    });
    await fn('addr-asking', { groupId: 'westend', sinceMs: 0 });
    expect(sendPeer).toHaveBeenCalledTimes(2);
  });

  it('uses getMyPubKey when payload.fromPubKey is missing', async () => {
    const callSkill = vi.fn(async () => ({
      posts: [{ requestId: 'r1', text: 'a', _addedAt: 1 }],   // no fromPubKey
    }));
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeHandleCatchUpRequest({
      callSkill, sendPeer,
      getMyPubKey: () => 'my-pubkey',
      logger: silentLogger,
    });
    await fn('addr-asking', { groupId: 'westend', sinceMs: 0 });
    expect(sendPeer.mock.calls[0][1].fromPubKey).toBe('my-pubkey');
  });
});

/* ── ε.3 — per-group peer handler + pod range-query handler ─────────── */

describe('makeRequestCatchUpForGroup (ε.3)', () => {
  it('skips when the roster is empty (0 peers)', async () => {
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listGroupRoster') return { members: [] };
      return null;
    });
    const sendPeer = vi.fn();
    const fn = makeRequestCatchUpForGroup({ callSkill, sendPeer, logger: silentLogger });
    const r = await fn({ circleId: 'westend' });
    expect(r.skipped).toBe(true);
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('falls back to getLatestPostAddedAt when sinceTs is missing or 0', async () => {
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-a' }] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 4242 };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpForGroup({ callSkill, sendPeer, logger: silentLogger });
    const r = await fn({ circleId: 'westend', sinceTs: 0 });
    expect(r.sent).toBe(1);
    expect(sendPeer.mock.calls[0][1].sinceMs).toBe(4242);
  });

  it('honours an explicit non-zero sinceTs (negotiated cursor)', async () => {
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-a' }] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 4242 };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpForGroup({ callSkill, sendPeer, logger: silentLogger });
    await fn({ circleId: 'westend', sinceTs: 100 });
    // The caller's cursor wins — getLatestPostAddedAt is not consulted.
    expect(sendPeer.mock.calls[0][1].sinceMs).toBe(100);
    const ops = callSkill.mock.calls.map((c) => c[1]);
    expect(ops).not.toContain('getLatestPostAddedAt');
  });
});

describe('makePodRangeQueryForGroup (ε.3)', () => {
  it('throws when no inbox is provided (substrate contract)', () => {
    expect(() => makePodRangeQueryForGroup({ callSkill: vi.fn() })).toThrow(/inbox/);
  });

  it('routes each returned envelope through inbox.ingestChatMessage with source:pod', async () => {
    const envelopes = [
      { subtype: 'kring-chat-message', circleId: 'g1', msgId: 'm1', ts: 1, text: 'a' },
      { subtype: 'kring-chat-message', circleId: 'g1', msgId: 'm2', ts: 2, text: 'b' },
    ];
    const callSkill = vi.fn(async () => ({ items: envelopes, truncated: false }));
    const inboxCalls = [];
    const inbox = {
      ingestChatMessage: vi.fn(async (env, opts) => {
        inboxCalls.push({ env, opts });
        return { result: 'inserted' };
      }),
    };
    const fn = makePodRangeQueryForGroup({ callSkill, inbox, logger: silentLogger });
    const r = await fn({ circleId: 'g1', sinceTs: 0 });
    expect(r.count).toBe(2);
    expect(r.inserted).toBe(2);
    expect(r.deduped).toBe(0);
    expect(r.truncated).toBe(false);
    // The first arg shape stoop's getMessagesSince expects:
    expect(callSkill.mock.calls[0]).toEqual(['stoop', 'getMessagesSince', {
      groupId: 'g1', sinceTs: 0, max: 200,
    }]);
    // Every inbox call carries source:'pod' so telemetry can attribute it.
    expect(inboxCalls.every((c) => c.opts.source === 'pod')).toBe(true);
  });

  it('counts deduped envelopes separately from inserted', async () => {
    const callSkill = vi.fn(async () => ({
      items: [
        { subtype: 'kring-chat-message', circleId: 'g1', msgId: 'm1', ts: 1, text: 'a' },
        { subtype: 'kring-chat-message', circleId: 'g1', msgId: 'm2', ts: 2, text: 'b' },
        { subtype: 'kring-chat-message', circleId: 'g1', msgId: 'm3', ts: 3, text: 'c' },
      ],
      truncated: true,
    }));
    let n = 0;
    const inbox = {
      ingestChatMessage: vi.fn(async () => {
        n += 1;
        return n === 2 ? { result: 'deduped' } : { result: 'inserted' };
      }),
    };
    const fn = makePodRangeQueryForGroup({ callSkill, inbox, logger: silentLogger });
    const r = await fn({ circleId: 'g1', sinceTs: 0 });
    expect(r.count).toBe(3);
    expect(r.inserted).toBe(2);
    expect(r.deduped).toBe(1);
    expect(r.truncated).toBe(true);
  });

  it('returns a no-op result when circleId is missing', async () => {
    const callSkill = vi.fn();
    const inbox = { ingestChatMessage: vi.fn() };
    const fn = makePodRangeQueryForGroup({ callSkill, inbox, logger: silentLogger });
    const r = await fn({});
    expect(callSkill).not.toHaveBeenCalled();
    expect(r.count).toBe(0);
  });

  it('propagates getMessagesSince failures so scheduleCatchUp can mark the path errored', async () => {
    const callSkill = vi.fn(async () => { throw new Error('skill-boom'); });
    const inbox = { ingestChatMessage: vi.fn() };
    const fn = makePodRangeQueryForGroup({ callSkill, inbox, logger: silentLogger });
    await expect(fn({ circleId: 'g1', sinceTs: 0 })).rejects.toThrow(/skill-boom/);
  });
});

describe('makeRequestCatchUpFromKnownPeers — ε.3 strategy dispatch', () => {
  it('routes pod:"shared" kringen through podRangeQuery (not peer) when inbox is wired', async () => {
    const podItems = [
      { subtype: 'kring-chat-message', circleId: 'kring-shared', msgId: 's1', ts: 1, text: 'hi' },
    ];
    const callSkill = vi.fn(async (_app, op, args) => {
      if (op === 'listMyBuurts')          return { buurts: ['kring-shared'] };
      if (op === 'getMessagesSince')      return { items: podItems, truncated: false };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 1 };
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-a' }] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const inbox   = { ingestChatMessage: vi.fn(async () => ({ result: 'inserted' })) };
    const getCirclePolicy = vi.fn(async () => ({ pod: 'shared' }));
    const fn = makeRequestCatchUpFromKnownPeers({
      callSkill, sendPeer, inbox, getCirclePolicy, logger: silentLogger,
    });
    await fn();
    expect(getCirclePolicy).toHaveBeenCalledWith('kring-shared');
    // Pod path called, peer path NOT called.
    const ops = callSkill.mock.calls.map((c) => c[1]);
    expect(ops).toContain('getMessagesSince');
    expect(sendPeer).not.toHaveBeenCalled();
    // Pod result fed through the inbox.
    expect(inbox.ingestChatMessage).toHaveBeenCalledTimes(1);
    expect(inbox.ingestChatMessage.mock.calls[0][1].source).toBe('pod');
  });

  it('routes pod:"personal" kringen through the existing peer path (bit-for-bit identical)', async () => {
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listMyBuurts')          return { buurts: ['kring-personal'] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 999 };
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-a' }] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const inbox   = { ingestChatMessage: vi.fn() };
    const getCirclePolicy = async () => ({ pod: 'personal' });
    const fn = makeRequestCatchUpFromKnownPeers({
      callSkill, sendPeer, inbox, getCirclePolicy, logger: silentLogger,
    });
    await fn();
    // Pod handler not consulted.
    expect(inbox.ingestChatMessage).not.toHaveBeenCalled();
    // Peer envelope identical to pre-ε.3.
    expect(sendPeer).toHaveBeenCalledTimes(1);
    expect(sendPeer.mock.calls[0][1]).toMatchObject({
      type:    'p2p-chat',
      subtype: 'catch-up-request',
      groupId: 'kring-personal',
      sinceMs: 999,
    });
  });

  it('defaults to {pod:"personal"} when getCirclePolicy is not wired (back-compat)', async () => {
    // No inbox, no getCirclePolicy → behaviour identical to pre-ε.3.
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listMyBuurts')          return { buurts: ['k1'] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 7 };
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-x' }] };
      return null;
    });
    const sendPeer = vi.fn(async () => ({}));
    const fn = makeRequestCatchUpFromKnownPeers({ callSkill, sendPeer, logger: silentLogger });
    await fn();
    expect(sendPeer).toHaveBeenCalledTimes(1);
    expect(sendPeer.mock.calls[0][1].sinceMs).toBe(7);
  });

  it('with no inbox + pod:"shared", the dispatcher returns deferred without crashing', async () => {
    // Forward-compat: a shared kring without the pod handler wired must
    // not throw — strategy router returns `deferred`, outer loop logs
    // and continues.  Peer path is NOT invoked for shared kringen.
    const callSkill = vi.fn(async (_app, op) => {
      if (op === 'listMyBuurts')   return { buurts: ['k1'] };
      if (op === 'listGroupRoster')       return { members: [{ addr: 'addr-x' }] };
      if (op === 'getLatestPostAddedAt')  return { latestAt: 0 };
      return null;
    });
    const sendPeer = vi.fn();
    const getCirclePolicy = async () => ({ pod: 'shared' });
    const fn = makeRequestCatchUpFromKnownPeers({
      callSkill, sendPeer, getCirclePolicy, logger: silentLogger,
    });
    await expect(fn()).resolves.not.toThrow();
    expect(sendPeer).not.toHaveBeenCalled();
  });
});
