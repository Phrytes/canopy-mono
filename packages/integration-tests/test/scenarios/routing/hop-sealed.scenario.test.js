/**
 * routing/hop-sealed — Bob's payload arrives intact via Carol-bridge
 * with sealed forward; Carol's relay-receive log contains no plaintext
 * fragment of the message.
 *
 * What this scenario verifies:
 *   1. Alice can `packSealed` an invocation addressed to Bob.
 *   2. The sealed envelope traversing Carol carries only ciphertext +
 *      nonce — Carol sees no plaintext fragment of Alice's message.
 *   3. Bob (the final hop with the right identity) can `openSealed`
 *      and recover the exact parts Alice sent.
 *
 * Implementation note: we don't drive the full hopTunnel skill chain
 * here (that's exercised by core unit tests).  We exercise the
 * sealed-forward primitive directly — pack → forward (Carol records the
 * sealed payload exactly as it would on the wire) → unpack at Bob —
 * and use `lab.assertNoLeak` against Carol's recorded "envelopes".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  packSealed,
  openSealed,
  signOrigin,
  TextPart,
} from '@canopy/core';
import { Lab } from '../../../src/_harness/index.js';

describe('routing/hop-sealed', () => {
  let lab;

  beforeEach(async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob', 'carol'] });
  });

  afterEach(async () => {
    if (lab) {
      await lab.teardown();
      lab = null;
    }
  });

  it('Carol-bridge sees only ciphertext; Bob recovers the plaintext', async () => {
    const alice = lab.agent('alice');
    const bob   = lab.agent('bob');
    const carol = lab.agent('carol');

    // Enable leak logging on Carol BEFORE the secret travels.
    lab.enableLeakLogging('carol');

    // The secret payload Alice wants to deliver to Bob.
    const secret = 'top-secret-hop-payload-XYZ-7f3c1a';
    const parts  = [TextPart(secret)];

    // Alice signs the origin and packs the invocation sealed to Bob.
    const { originTs, sig } = signOrigin(alice.identity, {
      target: bob.pubKey,
      skill:  'echo',
      parts,
    });
    const { sealed, nonce } = packSealed({
      identity:        alice.identity,
      recipientPubKey: bob.pubKey,
      skill:           'echo',
      parts,
      origin:          alice.pubKey,
      originSig:       sig,
      originTs,
    });

    // Sanity check: ciphertext + nonce are base64url strings, no plaintext.
    expect(typeof sealed).toBe('string');
    expect(typeof nonce).toBe('string');
    if (sealed.includes(secret) || nonce.includes(secret)) {
      throw new Error(
        `seal-leak: expected={sealed:no-plaintext,nonce:no-plaintext}, ` +
        `got={sealed-contains-secret:${sealed.includes(secret)},` +
        `nonce-contains-secret:${nonce.includes(secret)}}, ` +
        `edge-states={alice→carol→bob, sealed-forward:enabled}`
      );
    }

    // Hello so Carol's SecurityLayer knows Bob's pubKey.
    await carol.hello(bob.address);
    await alice.hello(carol.address);

    // Simulate Carol acting as the relay-bridge: she forwards the
    // sealed envelope on to Bob.  The forward goes through Carol's
    // wrapped `_send`, which is exactly what `lab.enableLeakLogging`
    // hooked — so the leak log captures the bridge's view of the
    // payload.  In a real hop over Carol, the relay-forward skill
    // emits a similarly-shaped envelope.  The cipher remains opaque
    // to Carol (she has no decryption capability without Bob's key).
    const bridgeEnvelope = {
      _p:           'fwd',                  // protocol marker (out-of-band)
      _from:        alice.address,
      _to:          bob.address,
      _id:          'hop-sealed-1',
      kind:         'sealed-forward',
      senderPubKey: alice.pubKey,
      sealed,
      nonce,
    };
    await carol.transport._send(bob.address, bridgeEnvelope);

    // Bob unseals.  He uses HIS identity to decrypt.
    const opened = openSealed({
      identity:     bob.identity,
      sealed,
      nonce,
      senderPubKey: alice.pubKey,
    });

    expect(opened.skill).toBe('echo');
    expect(Array.isArray(opened.parts)).toBe(true);
    expect(opened.parts.length).toBe(1);
    // The plaintext of the inner part round-trips byte-identical.
    const innerText = opened.parts[0]?.text ?? opened.parts[0]?.content ?? null;
    if (innerText !== secret) {
      throw new Error(
        `unseal: expected={text:'${secret}'}, ` +
        `got={text:${innerText === null ? 'null' : `'${innerText}'`}}, ` +
        `edge-states={alice→carol→bob, sealed-forward:enabled}`
      );
    }

    // Finally: assert Carol's leak log contains no plaintext fragment.
    // (The harness scans every captured envelope for the secret string.)
    await lab.assertNoLeak('carol', secret);
  });
});
