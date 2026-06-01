/**
 * ε.4 — integration: two in-process agents (Alice provider, Bob
 * receiver) exchange the negotiated catch-up protocol through a
 * synthetic peer-router.
 *
 * The "router" is a plain `address → handler` map.  Each agent's
 * `sendToPeer` looks up the target's handler and invokes it
 * synchronously; the handler dispatches by `subtype` to the
 * provider's `handler` (catch-up-request) or the receiver's
 * `onPeerMessage` (catch-up-offer / -chunk / -end).
 *
 * Alice owns a stub `callSkill('stoop', 'getMessagesSince', …)` that
 * returns N chat envelopes since `sinceTs`.  Bob owns a fake inbox
 * that records every ingest call.
 *
 * Expected outcome: Bob's inbox sees ALL of Alice's messages tagged
 * with `source: 'catchUp'`.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCatchUpProviderHandler } from '../../src/v2/catchUpProvider.js';
import { makeCatchUpReceiver }        from '../../src/v2/catchUpReceiver.js';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function mkItem(i, ts) {
  return {
    subtype: 'kring-chat-message',
    circleId: 'g1',
    msgId: `m${i}`,
    ts,
    text: `msg-${i}`,
    fromActor: 'webid:alice',
  };
}

describe('ε.4 — Alice ⇄ Bob negotiated catch-up integration', () => {
  it('Bob ends up with all of Alice\'s messages in his inbox', async () => {
    vi.useFakeTimers();
    // The synthetic peer-router: address → handler.
    const router = new Map();
    const send = async (toAddr, env) => {
      const h = router.get(toAddr);
      if (!h) throw new Error(`No handler for ${toAddr}`);
      // Microtask-y so handlers behave like real async dispatchers.
      await Promise.resolve();
      await h(`from-other-side`, env);
    };

    // Alice's stoop has 7 chat-message envelopes.
    const aliceItems = Array.from({ length: 7 }, (_, i) => mkItem(i, 1000 + i));
    const aliceCallSkill = vi.fn(async (origin, op, args) => {
      if (origin === 'stoop' && op === 'getMessagesSince') {
        const sinceTs = Number.isFinite(args?.sinceTs) ? args.sinceTs : 0;
        const filtered = aliceItems.filter((it) => it.ts >= sinceTs);
        return { items: filtered, truncated: false };
      }
      return null;
    });

    const aliceProvider = makeCatchUpProviderHandler({
      callSkill:  aliceCallSkill,
      sendToPeer: (toAddr, env) => send(toAddr, env),
      chunkSize: 3,
      logger: silentLogger,
    });

    // Bob's inbox is a fake recorder.
    const bobInboxCalls = [];
    const bobInbox = {
      async ingestChatMessage(env, opts) {
        bobInboxCalls.push({ env, opts });
        return { result: 'inserted' };
      },
    };
    const bobReceiver = makeCatchUpReceiver({
      sendToPeer: (toAddr, env) => send(toAddr, env),
      inbox: bobInbox,
      offerWindowMs: 50,
      chunkTimeoutMs: 1000,
      logger: silentLogger,
    });

    // Register handlers on the synthetic router.  Alice answers
    // catch-up-request + catch-up-accept; Bob handles -offer,
    // -chunk, -end.
    router.set('nkn-Alice', async (_from, payload) => {
      if (payload?.subtype === 'catch-up-request') {
        return aliceProvider.handler('nkn-Bob', payload);
      }
      if (payload?.subtype === 'catch-up-accept') {
        return aliceProvider.onAccept('nkn-Bob', payload);
      }
    });
    router.set('nkn-Bob', async (_from, payload) => {
      return bobReceiver.onPeerMessage('nkn-Alice', payload);
    });

    // Bob triggers a catch-up against the kring's only peer (Alice).
    const pending = bobReceiver.requestCatchUp({
      circleId: 'g1',
      sinceTs: 0,
      knownPeers: ['nkn-Alice'],
      fromNknAddr: 'nkn-Bob',
    });

    // Pump microtasks + timers.  Several Promise.resolve() to let
    // nested awaits unwind.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    vi.advanceTimersByTime(100);   // past offer window
    for (let i = 0; i < 30; i += 1) await Promise.resolve();

    const result = await pending;
    expect(result.accepted).toBe(true);
    expect(result.count).toBe(7);
    expect(result.source).toBe('streamed');

    // Bob's inbox saw all 7 items, each tagged catchUp.
    expect(bobInboxCalls).toHaveLength(7);
    expect(bobInboxCalls.every((c) => c.opts.source === 'catchUp')).toBe(true);
    expect(bobInboxCalls.map((c) => c.env.msgId)).toEqual(
      ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'],
    );

    vi.useRealTimers();
  });

  it('Alice has 0 items → Bob resolves no-offers (silent decline path)', async () => {
    vi.useFakeTimers();
    const router = new Map();
    const send = async (toAddr, env) => {
      const h = router.get(toAddr);
      if (!h) return;
      await Promise.resolve();
      await h('from-other-side', env);
    };

    const aliceProvider = makeCatchUpProviderHandler({
      callSkill: vi.fn(async () => ({ items: [], truncated: false })),
      sendToPeer: (toAddr, env) => send(toAddr, env),
      logger: silentLogger,
    });
    const bobInbox = { ingestChatMessage: vi.fn(async () => ({ result: 'inserted' })) };
    const bobReceiver = makeCatchUpReceiver({
      sendToPeer: (toAddr, env) => send(toAddr, env),
      inbox: bobInbox,
      offerWindowMs: 50,
      chunkTimeoutMs: 1000,
      logger: silentLogger,
    });

    router.set('nkn-Alice', async (_from, payload) => {
      if (payload?.subtype === 'catch-up-request') return aliceProvider.handler('nkn-Bob', payload);
      if (payload?.subtype === 'catch-up-accept')  return aliceProvider.onAccept('nkn-Bob', payload);
    });
    router.set('nkn-Bob', async (_from, payload) => bobReceiver.onPeerMessage('nkn-Alice', payload));

    const pending = bobReceiver.requestCatchUp({
      circleId: 'g1', sinceTs: 0,
      knownPeers: ['nkn-Alice'], fromNknAddr: 'nkn-Bob',
    });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    vi.advanceTimersByTime(100);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();

    const r = await pending;
    expect(r.accepted).toBe(false);
    expect(r.source).toBe('no-offers');
    expect(bobInbox.ingestChatMessage).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
