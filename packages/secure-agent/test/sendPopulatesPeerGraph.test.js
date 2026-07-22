/**
 * @onderling/secure-agent — Phase-2 · slice 2b (population) integration test.
 *
 * Slice 2 attached a PeerGraph to the shared secure router and proved the send
 * path CONSULTS it (`route → addressFor → addressesOf`). But on the live path
 * nothing WROTE peers' per-transport addresses INTO that graph, so
 * `addressesOf` stayed empty and the redeem degraded to (and failed over) NKN.
 *
 * Slice 2b closes the write side. Two population points:
 *   - on join: the invite's admin addresses are upserted before the redeem
 *     (covered by the basis unit test `populateAdminAddresses.test.js`);
 *   - on connect: once a first-contact HI resolves a live route to a peer, the
 *     send path records that peer's transport-appropriate wire address into the
 *     attached graph — proven HERE, so LATER sends resolve `addressesOf(peer)`.
 *
 * REAL transport wiring — no bespoke mocks: a genuine `InternalTransport` on an
 * `InternalBus`, delivered in-process (deterministic, no sockets/relay). The
 * wire address equals the pubKey here (relay semantics — the landed path); the
 * distinct-NKN-native-address delivery needs the deferred pubKey→NKN
 * translation + two real devices, so it is intentionally NOT asserted here.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport, PeerGraph } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 800, retryDelays: [] };

async function until(pred, { timeout = 1500, step = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return pred();
}

async function makeAgent(onPeerMessage) {
  return createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false });
}

describe('secure-agent slice-2b — the send path populates the attached PeerGraph on first-contact HI', () => {
  it('a redeem-style send over relay records the peer\'s relay wire address into the graph (empty → resolvable)', async () => {
    const busRelay = new InternalBus();

    const received = [];
    const sender = await makeAgent();
    const target = await makeAgent((m) => received.push(m));

    const targetId = target.identity.pubKey;

    await sender.addSecureTransport('relay', new InternalTransport(busRelay, sender.identity.pubKey));
    await target.addSecureTransport('relay', new InternalTransport(busRelay, targetId));

    // Attach an EMPTY app-owned graph — nothing is known about the target yet.
    const graph = new PeerGraph();
    sender.attachPeerGraph(graph);
    expect(await graph.addressesOf(targetId)).toEqual({});   // control: unpopulated

    // Redeem-style send. First contact runs HI (resolving a live relay route),
    // then the one-way payload is delivered over the relay bus.
    await sender.peer.sendTo(targetId, { subtype: 'redeem', body: 'first-contact' }, FAST);
    const redeem = await until(() => received.find((m) => m.payload?.subtype === 'redeem'));
    expect(redeem?.payload).toEqual({ subtype: 'redeem', body: 'first-contact' });

    // slice-2b — the send path recorded the resolved route, so `addressesOf`
    // now resolves the relay wire address for the peer: LATER sends resolve
    // instead of degrading to the bare id.
    expect(await graph.addressesOf(targetId)).toEqual({ relay: targetId });

    await sender.shutdown();
    await target.shutdown();
  });

  it('with no PeerGraph attached the send still succeeds — population is additive, never required', async () => {
    const busRelay = new InternalBus();

    const received = [];
    const sender = await makeAgent();
    const target = await makeAgent((m) => received.push(m));
    const targetId = target.identity.pubKey;

    await sender.addSecureTransport('relay', new InternalTransport(busRelay, sender.identity.pubKey));
    await target.addSecureTransport('relay', new InternalTransport(busRelay, targetId));

    // No attachPeerGraph — routing.peerGraph is null; the population is skipped.
    expect(sender.peerGraph).toBeFalsy();

    await sender.peer.sendTo(targetId, { subtype: 'redeem', body: 'no-graph' }, FAST);
    const redeem = await until(() => received.find((m) => m.payload?.subtype === 'redeem'));
    expect(redeem?.payload).toEqual({ subtype: 'redeem', body: 'no-graph' });

    await sender.shutdown();
    await target.shutdown();
  });
});
