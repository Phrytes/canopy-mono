/**
 * Group FF+1 — Inline rotation proof during grace.
 *
 * Scenario the plain broadcast doesn't cover: Bob is OFFLINE when Alice
 * broadcasts her rotation.  He comes back later, sees an envelope from
 * Alice that's signed with her NEW key, and would otherwise drop it
 * (bob.peers[alice.address] = aliceOld → signature verify fails).
 *
 * FF+1 fix: Alice's SecurityLayer attaches `env._rotationProof` to every
 * outbound encrypted envelope during grace.  Bob's SecurityLayer sees
 * the proof, verifies it against aliceOld (still his current mapping),
 * migrates `bob.peers[alice.address] → aliceNew`, THEN runs the normal
 * signature verify — which now succeeds.  Agent._dispatch then mirrors
 * the migration into PeerGraph and emits 'peer-rotated'.
 */
import { describe, it, expect } from 'vitest';
import { Agent }                from '../src/Agent.js';
import { AgentIdentity }        from '../src/identity/AgentIdentity.js';
import { VaultMemory }          from '../src/identity/VaultMemory.js';
import { PeerGraph }            from '../src/discovery/PeerGraph.js';
import { TextPart, Parts }      from '../src/Parts.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';

async function makeAgent(bus, { label } = {}) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey, { identity }),
    peers:     new PeerGraph(),
    label,
  });
  agent.register('echo', async ({ parts }) => {
    return [TextPart(`echo:${Parts.text(parts) ?? ''}`)];
  }, { visibility: 'public' });
  await agent.start();
  return agent;
}

describe('Inline rotation proof during grace (Group FF+1)', () => {

  it('bob auto-migrates on first post-rotation envelope from alice (no broadcast)', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus, { label: 'alice' });
    const bob   = await makeAgent(bus, { label: 'bob' });
    await alice.hello(bob.address);

    const aliceOrig = alice.pubKey;
    expect(bob.security.getPeerKey(alice.address)).toBe(aliceOrig);

    // Rotate WITHOUT broadcasting.  Bob still has aliceOrig registered.
    // Alice's SecurityLayer now carries the inline proof.
    await alice.rotateIdentity({ gracePeriodSeconds: 60, broadcast: false });
    expect(alice.pubKey).not.toBe(aliceOrig);
    expect(bob.security.getPeerKey(alice.address)).toBe(aliceOrig);

    // First post-rotation envelope: a full invoke round trip.  With the
    // inline proof, Bob's SecurityLayer migrates pre-verify, so:
    //   • Alice's NEW-key signature on the RQ verifies on Bob's side,
    //   • Bob's RS encrypted to aliceNew decrypts on Alice's side
    //     (current identity, no grace-history lookup needed).
    const rotated = new Promise(res => bob.once('peer-rotated', res));

    const reply = await alice.invoke(bob.address, 'echo', [TextPart('inline')]);
    expect(Parts.text(reply)).toBe('echo:inline');

    // Bob migrated as a side-effect of receiving the RQ with inline proof.
    const evt = await rotated;
    expect(evt.via).toBe('inline-proof');
    expect(evt.oldPubKey).toBe(aliceOrig);
    expect(evt.newPubKey).toBe(alice.pubKey);
    expect(bob.security.getPeerKey(alice.address)).toBe(alice.pubKey);

    await alice.stop(); await bob.stop();
  });

  it('PeerGraph is migrated alongside SecurityLayer when inline proof fires', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus, { label: 'alice' });
    const bob   = await makeAgent(bus, { label: 'bob' });
    await alice.hello(bob.address);

    // Seed a detailed peer record for alice on bob's side so we can
    // assert carry-over fields survive the inline migration.
    await bob.peers.upsert({
      pubKey: alice.pubKey,
      label:  'alice-laptop',
      groups: ['work'],
      skills: ['echo'],
    });
    const aliceOrig = alice.pubKey;

    await alice.rotateIdentity({ gracePeriodSeconds: 60, broadcast: false });
    await alice.invoke(bob.address, 'echo', [TextPart('pg')]);
    // Give any async PeerGraph upserts time to land.
    await new Promise(r => setTimeout(r, 15));

    const newRec = await bob.peers.get(alice.pubKey);
    expect(newRec).toBeTruthy();
    expect(newRec.label).toBe('alice-laptop');
    expect(newRec.groups).toEqual(expect.arrayContaining(['work']));
    expect(newRec.rotatedFrom).toBe(aliceOrig);

    const oldRec = await bob.peers.get(aliceOrig);
    expect(oldRec.rotatedTo).toBe(alice.pubKey);
    expect(oldRec.reachable).toBe(false);

    await alice.stop(); await bob.stop();
  });

  it('deduplicates — subsequent envelopes during grace do not re-fire peer-rotated', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus, { label: 'alice' });
    const bob   = await makeAgent(bus, { label: 'bob' });
    await alice.hello(bob.address);

    await alice.rotateIdentity({ gracePeriodSeconds: 60, broadcast: false });

    const events = [];
    bob.on('peer-rotated', e => events.push(e));

    // Three invokes during the grace window — Bob should migrate ONCE.
    await alice.invoke(bob.address, 'echo', [TextPart('a')]);
    await alice.invoke(bob.address, 'echo', [TextPart('b')]);
    await alice.invoke(bob.address, 'echo', [TextPart('c')]);

    await new Promise(r => setTimeout(r, 15));
    expect(events.length).toBe(1);

    await alice.stop(); await bob.stop();
  });

  it('forged inline proof does NOT migrate (signature mismatch → sig verify fails)', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus, { label: 'alice' });
    const bob   = await makeAgent(bus, { label: 'bob' });
    await alice.hello(bob.address);

    const aliceOrig = alice.pubKey;

    // Alice rotates legitimately — this produces a real inline proof
    // attached to her outbound envelopes.  Capture it via a spy.
    await alice.rotateIdentity({ gracePeriodSeconds: 60, broadcast: false });

    // Forge a DIFFERENT proof: we tamper the inline proof so its sig
    // no longer matches proof.oldPubKey.  Bob's SecurityLayer should
    // reject the migration (invalid sig) and fall through to normal
    // sig-verify — which ALSO fails because Alice signed with NEW key
    // and Bob still has OLD registered.  Net: envelope dropped, Bob's
    // mapping stays OLD.
    const origEncrypt = alice.security.encrypt.bind(alice.security);
    alice.security.encrypt = (env) => {
      const out = origEncrypt(env);
      if (out._rotationProof) {
        out._rotationProof = { ...out._rotationProof, sig: 'AA'.repeat(40) };
      }
      return out;
    };

    const rotated = [];
    bob.on('peer-rotated', e => rotated.push(e));

    // The invoke will time out because bob's verify fails silently.
    const task = alice.call(bob.address, 'echo', [TextPart('forged')], { timeout: 300 });
    try { await task.done(); } catch { /* expected */ }

    expect(rotated).toHaveLength(0);
    expect(bob.security.getPeerKey(alice.address)).toBe(aliceOrig);

    alice.security.encrypt = origEncrypt;
    await alice.stop(); await bob.stop();
  });

  it('stops attaching the proof once grace expires', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus, { label: 'alice' });
    const bob   = await makeAgent(bus, { label: 'bob' });
    await alice.hello(bob.address);

    await alice.rotateIdentity({ gracePeriodSeconds: 0.05, broadcast: false });
    await new Promise(r => setTimeout(r, 100));  // past graceUntil

    // Spy on encrypt to confirm no more _rotationProof field.
    const origEncrypt = alice.security.encrypt.bind(alice.security);
    const emittedHasProof = [];
    alice.security.encrypt = (env) => {
      const out = origEncrypt(env);
      emittedHasProof.push(!!out._rotationProof);
      return out;
    };

    // Any outbound — use a raw OW so we don't need a working round trip
    // (bob can't verify alice's NEW sig without the inline proof, but
    // that's not what we're asserting here).
    try {
      await alice.transport.sendOneWay(bob.address, { type: 'ping' });
    } catch { /* bob may drop; we only care about alice's encrypt */ }

    expect(emittedHasProof.length).toBeGreaterThanOrEqual(1);
    expect(emittedHasProof.every(x => x === false)).toBe(true);

    alice.security.encrypt = origEncrypt;
    await alice.stop(); await bob.stop();
  });
});
