/**
 * Group FF1 — Peer key-rotation receive-path handler.
 *
 * Given a valid KeyRotationProof arriving as an OW envelope, the agent
 * should:
 *   • verify the proof's signature matches proof.oldPubKey
 *   • migrate SecurityLayer entries (addr → oldPub becomes addr → newPub)
 *   • migrate PeerGraph (new record under newPub, old marked rotatedTo)
 *   • emit 'peer-rotated'
 *
 * And should reject:
 *   • forged proofs (signature invalid)
 *   • mismatched sender (proof.oldPubKey != senderKey we hold)
 *   • missing proof payload
 */
import { describe, it, expect } from 'vitest';
import { Agent }                from '../../src/Agent.js';
import { AgentIdentity }        from '../../src/identity/AgentIdentity.js';
import { VaultMemory }          from '@onderling/vault';
import { KeyRotation }          from '../../src/identity/KeyRotation.js';
import { PeerGraph }            from '../../src/discovery/PeerGraph.js';
import { InternalBus, InternalTransport } from '../../src/transport/InternalTransport.js';

async function makeAgent(bus, { peers = null } = {}) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey, { identity }),
    peers,
  });
  await agent.start();
  return agent;
}

describe('keyRotation receive-path (Group FF1)', () => {

  it('accepts a valid rotation proof and migrates SecurityLayer', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus, { peers: new PeerGraph() });
    await alice.hello(bob.address);

    // Alice generates a new identity (simulating her rotation).
    const newIdentity = await AgentIdentity.generate(new VaultMemory());
    const proof = await KeyRotation.buildProof(alice.identity, newIdentity.pubKey);

    // Pre-rotation: bob has Alice's address → oldPub mapping.
    expect(bob.security.getPeerKey(alice.address)).toBe(alice.pubKey);

    // Alice's agent sends the proof as a one-way envelope.  Uses the
    // raw transport.sendOneWay so we don't have to wire a rotate()
    // method yet (that's FF3).
    const rotated = new Promise(r => bob.on('peer-rotated', r));
    await alice.transport.sendOneWay(bob.address, {
      type:  'key-rotation',
      proof,
    });
    const event = await rotated;

    expect(event.oldPubKey).toBe(alice.pubKey);
    expect(event.newPubKey).toBe(newIdentity.pubKey);
    expect(event.inGrace).toBe(true);

    // After migration: addr→newPub, and newPub is self-registered too.
    expect(bob.security.getPeerKey(alice.address)).toBe(newIdentity.pubKey);
    expect(bob.security.getPeerKey(newIdentity.pubKey)).toBe(newIdentity.pubKey);

    await alice.stop(); await bob.stop();
  });

  it('migrates PeerGraph — old record marked rotatedTo, new record under newPub', async () => {
    const bus   = new InternalBus();
    const bobPeers = new PeerGraph();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus, { peers: bobPeers });
    await alice.hello(bob.address);

    // Seed: pretend bob had a detailed record of alice.
    await bobPeers.upsert({
      pubKey:     alice.pubKey,
      label:      'alice-laptop',
      skills:     ['greet', 'echo'],
      groups:     ['friends'],
      reachable:  true,
      transports: { internal: { address: alice.address, lastSeen: Date.now() } },
    });

    const newIdentity = await AgentIdentity.generate(new VaultMemory());
    const proof = await KeyRotation.buildProof(alice.identity, newIdentity.pubKey);

    const rotated = new Promise(r => bob.on('peer-rotated', r));
    await alice.transport.sendOneWay(bob.address, { type: 'key-rotation', proof });
    await rotated;
    // PeerGraph upsert is async; give the microtask queue a beat.
    await new Promise(r => setTimeout(r, 5));

    const newRecord = await bobPeers.get(newIdentity.pubKey);
    expect(newRecord).toBeTruthy();
    expect(newRecord.pubKey).toBe(newIdentity.pubKey);
    expect(newRecord.label).toBe('alice-laptop');
    expect(newRecord.skills).toEqual(expect.arrayContaining(['greet', 'echo']));
    expect(newRecord.groups).toEqual(expect.arrayContaining(['friends']));
    expect(newRecord.rotatedFrom).toBe(alice.pubKey);

    const oldRecord = await bobPeers.get(alice.pubKey);
    expect(oldRecord.rotatedTo).toBe(newIdentity.pubKey);
    expect(oldRecord.reachable).toBe(false);

    await alice.stop(); await bob.stop();
  });

  it('rejects forged proof (signature not signed by oldPubKey)', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus, { peers: new PeerGraph() });
    const mallory = await AgentIdentity.generate(new VaultMemory());  // unrelated identity
    await alice.hello(bob.address);

    // Mallory builds a "proof" that claims Alice is rotating to Mallory's key,
    // but signs it with Mallory's (wrong) private key.
    const newIdentity = await AgentIdentity.generate(new VaultMemory());
    const forged = await KeyRotation.buildProof(mallory, newIdentity.pubKey);
    forged.oldPubKey = alice.pubKey;   // tamper: claim it's about alice

    const rejections = [];
    bob.on('key-rotation-rejected', e => rejections.push(e));
    const rotated    = [];
    bob.on('peer-rotated', e => rotated.push(e));

    await alice.transport.sendOneWay(bob.address, { type: 'key-rotation', proof: forged });
    await new Promise(r => setTimeout(r, 10));

    expect(rotated).toHaveLength(0);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].reason).toBe('bad-signature');
    // SecurityLayer mapping untouched.
    expect(bob.security.getPeerKey(alice.address)).toBe(alice.pubKey);

    await alice.stop(); await bob.stop();
  });

  it('rejects proof whose oldPubKey does not match the sender', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus, { peers: new PeerGraph() });
    // A third identity — Carol.  Alice forwards a (valid) rotation proof
    // built for Carol's old key, hoping Bob will migrate Carol's record
    // based on an envelope whose _from is Alice.
    const carolOld = await AgentIdentity.generate(new VaultMemory());
    const carolNew = await AgentIdentity.generate(new VaultMemory());
    const proof = await KeyRotation.buildProof(carolOld, carolNew.pubKey);
    // Register Carol with Bob so senderKey lookup has something to compare.
    bob.security.registerPeer(alice.address, alice.pubKey);   // address already mapped; stays Alice

    await alice.hello(bob.address);
    const rejections = [];
    bob.on('key-rotation-rejected', e => rejections.push(e));

    await alice.transport.sendOneWay(bob.address, { type: 'key-rotation', proof });
    await new Promise(r => setTimeout(r, 10));

    expect(rejections).toHaveLength(1);
    expect(rejections[0].reason).toBe('sender-mismatch');

    await alice.stop(); await bob.stop();
  });

  it('ignores envelope when payload.type is not key-rotation (no false positives)', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus, { peers: new PeerGraph() });
    await alice.hello(bob.address);

    // A mundane OW message.
    const rotated = [];
    bob.on('peer-rotated', e => rotated.push(e));

    await alice.transport.sendOneWay(bob.address, { type: 'message', text: 'hi' });
    await new Promise(r => setTimeout(r, 10));

    expect(rotated).toHaveLength(0);

    await alice.stop(); await bob.stop();
  });
});
