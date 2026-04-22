/**
 * Capability advertising (Group AA3).
 *
 * Covers:
 *   • hello payload carries { capabilities: { rendezvous, originSig, … } }
 *     in both directions (initial HI and ack)
 *   • receiver stores capabilities on the PeerGraph record
 *   • `peer` event fires with capabilities when present
 *   • hello without capabilities still works (backward compat — peers
 *     from before AA3 don't send the field)
 *   • get-capabilities skill returns the expected snapshot shape
 *
 * Ref: Design-v3/rendezvous-mode.md §5, CODING-PLAN Group AA3.
 */
import { describe, it, expect } from 'vitest';
import { Agent }                                 from '../src/Agent.js';
import { AgentIdentity }                         from '../src/identity/AgentIdentity.js';
import { VaultMemory }                           from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport }        from '../src/transport/InternalTransport.js';
import { PeerGraph }                             from '../src/discovery/PeerGraph.js';
import { registerCapabilitiesSkill, _snapshot } from '../src/skills/capabilities.js';
import { Parts }                                 from '../src/Parts.js';

async function makePair({ aliceEnableRendezvous = false } = {}) {
  const bus    = new InternalBus();
  const aId    = await AgentIdentity.generate(new VaultMemory());
  const bId    = await AgentIdentity.generate(new VaultMemory());

  const alice = new Agent({
    identity:  aId,
    transport: new InternalTransport(bus, aId.pubKey, { identity: aId }),
    peers:     new PeerGraph(),
  });
  const bob = new Agent({
    identity:  bId,
    transport: new InternalTransport(bus, bId.pubKey, { identity: bId }),
    peers:     new PeerGraph(),
  });

  // No addPeer() — the tests exercise hello itself. Pre-registering
  // would make `agent.hello()` a no-op (see sendHello early-return on
  // an already-known key).
  await alice.start(); await bob.start();

  if (aliceEnableRendezvous) alice._rendezvousEnabled = true;

  return { alice, bob };
}

describe('hello protocol — capabilities field (AA3)', () => {

  it('initiator advertises its capability snapshot', async () => {
    const { alice, bob } = await makePair({ aliceEnableRendezvous: true });

    const peerEvent = new Promise(res => bob.once('peer', res));

    await alice.hello(bob.address);
    const evt = await peerEvent;

    expect(evt.capabilities).toBeTruthy();
    expect(evt.capabilities.rendezvous).toBe(true);
    expect(evt.capabilities.originSig).toBe(true);

    await alice.stop(); await bob.stop();
  });

  it('ack carries the responder\'s capabilities back', async () => {
    const { alice, bob } = await makePair();

    // Bob enables rendezvous; Alice does not.
    bob._rendezvousEnabled = true;

    const alicePeerEvt = new Promise(res => alice.once('peer', res));
    await alice.hello(bob.address);

    // Alice's peer event for Bob should see Bob's capabilities (incl.
    // rendezvous: true) via the ack.
    const evt = await alicePeerEvt;
    expect(evt.ack).toBe(true);
    expect(evt.capabilities.rendezvous).toBe(true);

    await alice.stop(); await bob.stop();
  });

  it('stores advertised capabilities on the PeerGraph record', async () => {
    const { alice, bob } = await makePair({ aliceEnableRendezvous: true });
    await alice.hello(bob.address);

    // Give the ack handler one tick to write back.
    await new Promise(r => setTimeout(r, 20));

    const rec = await bob.peers.get(alice.pubKey);
    expect(rec?.capabilities).toBeTruthy();
    expect(rec.capabilities.rendezvous).toBe(true);
    expect(rec.capabilities.originSig).toBe(true);

    await alice.stop(); await bob.stop();
  });

  it('capabilities absent → record.capabilities stays unset (no clobber)', async () => {
    const { alice, bob } = await makePair();
    // Pre-seed a fake capabilities entry on bob's record for Alice to
    // prove that a pre-AA3-style hello (no capabilities field) doesn't
    // wipe it.
    await bob.peers.upsert({
      pubKey: alice.pubKey,
      capabilities: { legacy: true },
    });

    // Directly drive handleHello with a capabilities-less payload to
    // simulate an old peer.
    const { handleHello } = await import('../src/protocol/hello.js');
    await handleHello(bob, {
      _from: alice.pubKey,
      payload: { pubKey: alice.pubKey, label: 'alice', ack: true },
    });

    const rec = await bob.peers.get(alice.pubKey);
    expect(rec.capabilities).toEqual({ legacy: true });

    await alice.stop(); await bob.stop();
  });
});

describe('get-capabilities skill (AA3)', () => {

  it('returns the expected shape', async () => {
    const { alice, bob } = await makePair({ aliceEnableRendezvous: true });
    registerCapabilitiesSkill(alice);
    await bob.hello(alice.address);

    const parts = await bob.invoke(alice.address, 'get-capabilities', []);
    const data  = Parts.data(parts);

    expect(data).toBeTruthy();
    expect(data.rendezvous).toBe(true);
    expect(data.originSig).toBe(true);
    expect(Array.isArray(data.groups)).toBe(true);
    expect(typeof data.relay).toBe('boolean');
    expect(typeof data.oracle).toBe('boolean');

    await alice.stop(); await bob.stop();
  });

  it('reports relay-forward when it is registered', async () => {
    const { alice, bob } = await makePair();
    registerCapabilitiesSkill(alice);
    alice.enableRelayForward({ policy: 'authenticated' });
    await bob.hello(alice.address);

    const parts = await bob.invoke(alice.address, 'get-capabilities', []);
    const data  = Parts.data(parts);
    expect(data.relay).toBe(true);

    await alice.stop(); await bob.stop();
  });

  it('snapshot unit: rendezvous flag reflects agent._rendezvousEnabled', async () => {
    const { alice } = await makePair();
    expect(_snapshot(alice).rendezvous).toBe(false);
    alice._rendezvousEnabled = true;
    expect(_snapshot(alice).rendezvous).toBe(true);
    await alice.stop();
  });
});
