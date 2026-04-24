/**
 * Rendezvous routing — unit-level test (no WebRTC, deterministic).
 *
 * Proves the Agent-side wiring in `enableRendezvous` without ever
 * involving `node-datachannel` or any real ICE / UDP stack:
 *
 *   • on `peer-connected` from the rendezvous transport, the Agent
 *     calls `routing.setPreferredTransport(peer, 'rendezvous')` and
 *     emits `rendezvous-upgraded`.
 *   • on `peer-disconnected`, it clears the pin and emits
 *     `rendezvous-downgraded`.
 *   • RoutingStrategy then picks rendezvous while it's pinned + can
 *     reach, and falls back to the signaling transport when the pin
 *     clears or canReach flips to false.
 *
 * We pass a dummy `rtcLib` that would throw if actually used, and
 * manually fire `peer-connected` / `peer-disconnected` on the
 * RendezvousTransport instance that `enableRendezvous` creates.
 *
 * Companion to the flakier `rendezvous.upgrade.test.js` which exercises
 * the full polyfilled ICE round-trip.  That one is slow + timing-
 * dependent; this one is milliseconds + deterministic.
 */
import { describe, it, expect } from 'vitest';
import { Agent }                      from '../src/Agent.js';
import { AgentIdentity }              from '../src/identity/AgentIdentity.js';
import { VaultMemory }                from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { PeerGraph }                  from '../src/discovery/PeerGraph.js';
import { RoutingStrategy }            from '../src/routing/RoutingStrategy.js';

// A harmless rtcLib that would throw if anyone tried to connect.
// enableRendezvous doesn't invoke it at construction; we never call
// connectToPeer in this test so nothing actually touches it.
const DUMMY_RTC = {
  RTCPeerConnection:     class { constructor() { throw new Error('unit test — do not connect'); } },
  RTCSessionDescription: class {},
  RTCIceCandidate:       class {},
};

async function makeAgent(bus) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const signal   = new InternalTransport(bus, identity.pubKey, { identity });
  const peers    = new PeerGraph();
  const routing  = new RoutingStrategy({
    transports: new Map([['relay', signal]]),
    peerGraph:  peers,
  });
  const agent = new Agent({ identity, transport: signal, peers, routing });
  await agent.start();
  agent.enableRendezvous({ signalingTransport: signal, rtcLib: DUMMY_RTC });
  return { agent, routing, signal };
}

describe('rendezvous routing wiring — unit', () => {

  it('peer-connected pins rendezvous + emits rendezvous-upgraded', async () => {
    const bus = new InternalBus();
    const { agent, routing } = await makeAgent(bus);
    const rdv = agent.getTransport('rendezvous');
    expect(rdv).toBeTruthy();

    const upgraded = new Promise(res => agent.once('rendezvous-upgraded', res));

    const peerPk = 'PEER_PUBKEY_A';
    rdv.emit('peer-connected', peerPk);

    const evt = await upgraded;
    expect(evt.peer).toBe(peerPk);
    expect(routing.getPreferredTransport(peerPk)).toBe('rendezvous');

    await agent.stop();
  });

  it('peer-disconnected clears the pin + emits rendezvous-downgraded', async () => {
    const bus = new InternalBus();
    const { agent, routing } = await makeAgent(bus);
    const rdv = agent.getTransport('rendezvous');

    const peerPk = 'PEER_PUBKEY_B';
    rdv.emit('peer-connected', peerPk);
    expect(routing.getPreferredTransport(peerPk)).toBe('rendezvous');

    const downgraded = new Promise(res => agent.once('rendezvous-downgraded', res));
    rdv.emit('peer-disconnected', peerPk);
    const evt = await downgraded;

    expect(evt.peer).toBe(peerPk);
    expect(evt.reason).toBe('channel-closed');
    expect(routing.getPreferredTransport(peerPk)).toBeNull();

    await agent.stop();
  });

  it('routing picks rendezvous while pinned AND canReach=true', async () => {
    const bus = new InternalBus();
    const { agent, routing } = await makeAgent(bus);
    const rdv = agent.getTransport('rendezvous');

    const peerPk = 'PEER_PUBKEY_C';
    // Fake a live DataChannel: stuff the transport's internal #peers so
    // hasOpenChannelTo returns true.  We do this via the same
    // 'peer-connected' event path the real transport uses — plus we
    // patch canReach to simulate an open channel.
    rdv.canReach = (pk) => pk === peerPk;
    rdv.emit('peer-connected', peerPk);

    const route = await routing.selectTransport(peerPk);
    expect(route?.name).toBe('rendezvous');

    await agent.stop();
  });

  it('routing falls back to signaling when pin is cleared', async () => {
    const bus = new InternalBus();
    const { agent, routing, signal } = await makeAgent(bus);
    const rdv = agent.getTransport('rendezvous');

    const peerPk = 'PEER_PUBKEY_D';
    rdv.canReach = (pk) => pk === peerPk;
    rdv.emit('peer-connected', peerPk);
    expect((await routing.selectTransport(peerPk))?.name).toBe('rendezvous');

    // Simulate DataChannel closing — RoutingStrategy's pinned check
    // fails (pin cleared) AND canReach flips to false.
    rdv.canReach = () => false;
    rdv.emit('peer-disconnected', peerPk);

    const route = await routing.selectTransport(peerPk);
    expect(route?.name).toBe('relay');
    expect(route?.transport).toBe(signal);

    await agent.stop();
  });

  it('routing falls back even if the pin is stale (canReach=false with pin still set)', async () => {
    // Defensive path: pin stays by some bug, but canReach returns false.
    // RoutingStrategy should still skip the pinned transport and pick
    // the next best.
    const bus = new InternalBus();
    const { agent, routing, signal } = await makeAgent(bus);
    const rdv = agent.getTransport('rendezvous');

    const peerPk = 'PEER_PUBKEY_E';
    rdv.canReach = (pk) => pk === peerPk;
    rdv.emit('peer-connected', peerPk);
    expect(routing.getPreferredTransport(peerPk)).toBe('rendezvous');

    // canReach flips (but pin is NOT cleared).
    rdv.canReach = () => false;

    const route = await routing.selectTransport(peerPk);
    expect(route?.name).toBe('relay');

    await agent.stop();
  });
});
