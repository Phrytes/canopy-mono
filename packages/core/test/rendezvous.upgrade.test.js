/**
 * Rendezvous upgrade / downgrade integration (Group AA4).
 *
 * Two Node agents with `node-datachannel/polyfill`:
 *   1. Both enableRendezvous({ auto: true }) with a shared InternalBus
 *      signalling transport.
 *   2. hello() fires; each sees `capabilities.rendezvous: true` from the
 *      peer, so the auto-upgrade hook calls connectToPeer in the
 *      background.
 *   3. Once the DataChannel is open, routing's preferredTransport for
 *      that peer is pinned to 'rendezvous'. A subsequent invoke() goes
 *      via WebRTC (verified by the transport tag on the receive path).
 *   4. Force-close the channel. The downgrade hook clears the pin; the
 *      next invoke falls back to the signalling transport.
 *
 * Also covers: explicit upgrade (auto: false), no auto-upgrade when the
 * peer doesn't advertise the flag, and the "no enableRendezvous" guard.
 *
 * Ref: Design-v3/rendezvous-mode.md §6-§7, CODING-PLAN Group AA4.
 */
import { describe, it, expect } from 'vitest';
import { Agent }                                 from '../src/Agent.js';
import { AgentIdentity }                         from '../src/identity/AgentIdentity.js';
import { VaultMemory }                           from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport }        from '../src/transport/InternalTransport.js';
import { PeerGraph }                             from '../src/discovery/PeerGraph.js';
import { RoutingStrategy }                       from '../src/routing/RoutingStrategy.js';
import { DataPart, Parts }                       from '../src/Parts.js';

// Optional polyfill — skip the suite if it fails to load.
let rtcLib = null;
try {
  const mod = await import('node-datachannel/polyfill');
  rtcLib = {
    RTCPeerConnection:     mod.RTCPeerConnection,
    RTCSessionDescription: mod.RTCSessionDescription,
    RTCIceCandidate:       mod.RTCIceCandidate,
  };
} catch { /* skip */ }

const d = rtcLib ? describe : describe.skip;

async function makePair({ auto = true } = {}) {
  const bus = new InternalBus();
  const aId = await AgentIdentity.generate(new VaultMemory());
  const bId = await AgentIdentity.generate(new VaultMemory());

  // Both agents use an InternalTransport as the signalling transport (would
  // be RelayTransport in production). The rendezvous transport is attached
  // via enableRendezvous() so addTransport() + routing hooks fire.
  const aSig = new InternalTransport(bus, aId.pubKey, { identity: aId });
  const bSig = new InternalTransport(bus, bId.pubKey, { identity: bId });

  // Multi-transport agents require a RoutingStrategy.
  const mkAgent = (identity, primary) => {
    const transports = new Map([['relay', primary]]);
    const peers      = new PeerGraph();
    const agent = new Agent({
      identity, transport: primary, peers,
      routing: new RoutingStrategy({ transports, peerGraph: peers }),
    });
    return agent;
  };

  const alice = mkAgent(aId, aSig);
  const bob   = mkAgent(bId, bSig);
  await alice.start(); await bob.start();

  alice.enableRendezvous({ signalingTransport: aSig, rtcLib, auto });
  bob.enableRendezvous  ({ signalingTransport: bSig, rtcLib, auto });

  // Both sides register a trivial echo skill so invoke() can succeed.
  const mkEcho = (agent, received) => {
    agent.register('echo', async ({ parts, envelope }) => {
      // Capture which transport delivered the RQ.
      const name = envelope?._transport?.constructor?.name ?? null;
      received.push({ parts, transport: name });
      return [DataPart({ ok: true })];
    }, { visibility: 'public' });
  };
  const bRx = [];
  const aRx = [];
  mkEcho(alice, aRx);
  mkEcho(bob,   bRx);

  return { alice, bob, bRx, aRx };
}

d('Agent.enableRendezvous + auto-upgrade', () => {

  it('auto: true — hello → upgrade → invoke goes via RendezvousTransport', async () => {
    const { alice, bob, bRx } = await makePair({ auto: true });

    // Wait for BOTH sides' DataChannel to open — they fire via different
    // code paths (initiator vs answerer) and can be ~10 ms apart.
    const aliceUp = new Promise(res => alice.once('rendezvous-upgraded', res));
    const bobUp   = new Promise(res => bob  .once('rendezvous-upgraded', res));
    await alice.hello(bob.address);
    const [aEvt, bEvt] = await Promise.race([
      Promise.all([aliceUp, bobUp]),
      new Promise((_, rej) => setTimeout(() => rej(new Error('upgrade timeout')), 15_000)),
    ]);
    expect(aEvt.peer).toBe(bob.pubKey);
    expect(bEvt.peer).toBe(alice.pubKey);

    expect(alice.isRendezvousActive(bob.pubKey)).toBe(true);
    expect(bob.isRendezvousActive(alice.pubKey)).toBe(true);

    await alice.invoke(bob.address, 'echo', [DataPart({ n: 1 })]);
    expect(bRx).toHaveLength(1);
    expect(bRx[0].transport).toBe('RendezvousTransport');

    await alice.stop(); await bob.stop();
  }, 30_000);

  it('on DataChannel close: routing pin cleared, next invoke uses relay', async () => {
    const { alice, bob, bRx } = await makePair({ auto: true });

    await new Promise(res => {
      alice.once('rendezvous-upgraded', res);
      alice.hello(bob.address);
    });

    await alice.invoke(bob.address, 'echo', [DataPart({ n: 1 })]);
    expect(bRx.at(-1).transport).toBe('RendezvousTransport');

    // Force a downgrade by tearing down rendezvous on alice's side.
    const downgraded = new Promise(res => alice.once('rendezvous-downgraded', res));
    await alice.getTransport('rendezvous').disconnect();
    await downgraded;

    expect(alice.isRendezvousActive(bob.pubKey)).toBe(false);

    // Re-enable a trivial rendezvous shell so the transport exists but is
    // empty; routing should skip it and fall back to relay.
    await alice.invoke(bob.address, 'echo', [DataPart({ n: 2 })]);
    expect(bRx.at(-1).transport).toBe('InternalTransport');

    await alice.stop(); await bob.stop();
  }, 30_000);

  it('auto: false — hello alone does NOT upgrade; explicit upgradeToRendezvous does', async () => {
    const { alice, bob } = await makePair({ auto: false });
    await alice.hello(bob.address);

    // Give any stray handlers a tick; nothing should happen.
    await new Promise(r => setTimeout(r, 200));
    expect(alice.isRendezvousActive(bob.pubKey)).toBe(false);

    await alice.upgradeToRendezvous(bob.pubKey, 15_000);
    expect(alice.isRendezvousActive(bob.pubKey)).toBe(true);

    await alice.stop(); await bob.stop();
  }, 30_000);

  it('no auto-upgrade when the peer does not advertise capabilities.rendezvous', async () => {
    // Alice has rendezvous; Bob doesn't.
    const bus = new InternalBus();
    const aId = await AgentIdentity.generate(new VaultMemory());
    const bId = await AgentIdentity.generate(new VaultMemory());
    const aSig = new InternalTransport(bus, aId.pubKey, { identity: aId });
    const bSig = new InternalTransport(bus, bId.pubKey, { identity: bId });
    const alice = new Agent({
      identity: aId, transport: aSig, peers: new PeerGraph(),
      routing:  new RoutingStrategy({ transports: new Map([['relay', aSig]]) }),
    });
    const bob = new Agent({
      identity: bId, transport: bSig, peers: new PeerGraph(),
    });
    await alice.start(); await bob.start();
    alice.enableRendezvous({ signalingTransport: aSig, rtcLib, auto: true });
    // Bob never calls enableRendezvous → bob's capabilities.rendezvous === false.

    let upgraded = false;
    alice.on('rendezvous-upgraded', () => { upgraded = true; });
    await alice.hello(bob.address);
    await new Promise(r => setTimeout(r, 500));

    expect(upgraded).toBe(false);
    expect(alice.isRendezvousActive(bob.pubKey)).toBe(false);

    await alice.stop(); await bob.stop();
  }, 15_000);

  it('upgradeToRendezvous throws when enableRendezvous was never called', async () => {
    const bus = new InternalBus();
    const aId = await AgentIdentity.generate(new VaultMemory());
    const alice = new Agent({
      identity:  aId,
      transport: new InternalTransport(bus, aId.pubKey, { identity: aId }),
    });
    await alice.start();
    await expect(alice.upgradeToRendezvous('some-peer'))
      .rejects.toThrow(/enableRendezvous\(\) not called/);
    await alice.stop();
  });
});
