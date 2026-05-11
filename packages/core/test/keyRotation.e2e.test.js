/**
 * Group FF4 — End-to-end key rotation.
 *
 * Two agents over InternalBus.
 *   1. Hello — both have each other's current pubkey.
 *   2. Alice rotates.
 *   3. Bob receives the broadcast automatically, PeerGraph + SecurityLayer
 *      migrate to Alice's new pubkey.
 *   4. Alice sends a message signed with NEW — Bob decrypts.
 *   5. Grace: a message encrypted to Alice's OLD pubkey (simulating a peer
 *      that missed the broadcast) still decrypts on Alice's side because
 *      SecurityLayer held her old identity in the grace window.
 *   6. After graceUntil passes, an envelope addressed to OLD fails cleanly.
 *
 * Also checks the vault blob roundtrip: after rotation, restoreWithPrevious
 * returns the previous identity + graceUntil.
 */
import { describe, it, expect } from 'vitest';
import { Agent }                from '../src/Agent.js';
import { AgentIdentity }        from '../src/identity/AgentIdentity.js';
import { VaultMemory }          from '@canopy/vault';
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

describe('Key rotation end-to-end (Group FF4)', () => {

  it('rotate → broadcast → peer updates → post-rotation invoke works', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus, { label: 'alice' });
    const bob   = await makeAgent(bus, { label: 'bob' });
    await alice.hello(bob.address);

    // Pre-rotation: bob knows alice by her original pubkey.
    const aliceOrig = alice.pubKey;
    expect(bob.security.getPeerKey(alice.address)).toBe(aliceOrig);

    // Sanity — invoke works pre-rotation.
    expect(Parts.text(await alice.invoke(bob.address, 'echo', [TextPart('pre')])))
      .toBe('echo:pre');

    // Rotate.  Broadcast fires automatically to bob via peergraph.
    const bobRotated = new Promise(res => bob.once('peer-rotated', res));
    const bobRejected = new Promise(res => bob.once('key-rotation-rejected', res));
    const rotateRes = await alice.rotateIdentity({ gracePeriodSeconds: 60 });
    expect(rotateRes.oldPubKey).toBe(aliceOrig);
    expect(rotateRes.newPubKey).toBe(alice.pubKey);
    expect(rotateRes.newPubKey).not.toBe(aliceOrig);

    // Bob should emit peer-rotated, NOT key-rotation-rejected.
    const which = await Promise.race([
      bobRotated.then(e => ({ kind: 'rotated', e })),
      bobRejected.then(e => ({ kind: 'rejected', e })),
      new Promise(res => setTimeout(() => res({ kind: 'timeout' }), 500)),
    ]);
    expect(which.kind).toBe('rotated');

    // Bob's SecurityLayer migrated.
    expect(bob.security.getPeerKey(alice.address)).toBe(alice.pubKey);

    // Post-rotation invoke: signed with new key, verifies against
    // migrated entry on Bob's side.
    expect(Parts.text(await alice.invoke(bob.address, 'echo', [TextPart('post')])))
      .toBe('echo:post');

    await alice.stop(); await bob.stop();
  });

  it('vault blob contains previous seed + graceUntil after rotate', async () => {
    const vault = new VaultMemory();
    const id0 = await AgentIdentity.generate(vault);
    const oldPub = id0.pubKey;

    const { newIdentity, graceUntil } =
      await AgentIdentity.rotate(vault, { gracePeriodSeconds: 120 });
    expect(newIdentity.pubKey).not.toBe(oldPub);
    expect(graceUntil).toBeGreaterThan(Date.now());

    const { current, previous } = await AgentIdentity.restoreWithPrevious(vault);
    expect(current.pubKey).toBe(newIdentity.pubKey);
    expect(previous).toBeTruthy();
    expect(previous.identity.pubKey).toBe(oldPub);
    expect(previous.graceUntil).toBe(graceUntil);
  });

  it('grace: OW encrypted to OLD pubkey still decrypts after rotation', async () => {
    // Scenario: Bob has not yet received Alice's rotation broadcast and
    // sends a one-way message addressed to Alice-old.  Alice (now
    // rotated) must still decrypt it during grace.
    //
    // NB: an invoke() round-trip wouldn't work here — Alice replies with
    // a sig from her NEW key, but Bob still has her OLD key registered
    // so his signature verify would reject the RS.  That's inherent to
    // the partial-broadcast scenario, not a grace bug.  The receive-path
    // alone (which is what grace is actually about) proves it works.
    const bus   = new InternalBus();
    const alice = await makeAgent(bus, { label: 'alice' });
    const bob   = await makeAgent(bus, { label: 'bob' });
    await alice.hello(bob.address);

    const aliceOrig = alice.pubKey;
    expect(bob.security.getPeerKey(alice.address)).toBe(aliceOrig);

    await alice.rotateIdentity({ gracePeriodSeconds: 60, broadcast: false });
    expect(bob.security.getPeerKey(alice.address)).toBe(aliceOrig);  // bob unchanged

    // Bob sends an OW message to Alice.  Bob's security encrypts to
    // aliceOrig (the pubkey he still has). Alice's decrypt picks the
    // grace-period OLD identity because env._to === aliceOrig, and the
    // envelope reaches Agent._dispatch which routes generic-payload OW
    // to handleMessage → emits 'message'.
    const received = new Promise(r => alice.once('message', r));
    await bob.transport.sendOneWay(alice.address, {
      parts: [{ text: 'hi-during-grace' }],
    });
    const msg = await Promise.race([
      received,
      new Promise((_, rej) => setTimeout(() => rej(new Error('no message')), 500)),
    ]);
    expect(msg.parts[0].text).toBe('hi-during-grace');

    await alice.stop(); await bob.stop();
  });

  it('grace expiry: envelopes to OLD pubkey decrypt-fail after graceUntil', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus, { label: 'alice' });
    const bob   = await makeAgent(bus, { label: 'bob' });
    await alice.hello(bob.address);

    // Rotate with a 50 ms grace window; no broadcast → bob keeps OLD.
    await alice.rotateIdentity({ gracePeriodSeconds: 0.05, broadcast: false });
    await new Promise(r => setTimeout(r, 100));   // past grace

    // Alice's SecurityLayer should refuse to decrypt envelopes addressed
    // to her expired OLD pubkey.  We detect this via the
    // 'security-error' transport event since the error happens before
    // the envelope reaches the application layer.
    const errs = [];
    alice.transport.on('security-error', e => errs.push(e));
    await bob.transport.sendOneWay(alice.address, {
      type: 'message',
      text: 'after-grace',
    });
    await new Promise(r => setTimeout(r, 30));

    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(/DECRYPT_FAILED|nacl\.box\.open/.test(errs[0].message ?? '')).toBe(true);

    await alice.stop(); await bob.stop();
  });
});
