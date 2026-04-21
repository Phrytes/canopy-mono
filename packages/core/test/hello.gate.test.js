/**
 * handleHello — gate integration (Group W).
 *
 * Verifies that setHelloGate + handleHello together produce the promised
 * behaviour:
 *   - No gate set → today's behaviour (accept all hellos).
 *   - Gate returns false → silent drop. No ack, no 'peer' event on the
 *     receiver, no SecurityLayer key carried over, caller's sendHello
 *     times out exactly like an offline peer.
 *   - Gate throws → fail closed (same as false).
 *   - Gate returns true → normal flow.
 */
import { describe, it, expect } from 'vitest';
import { Agent }           from '../src/Agent.js';
import { AgentIdentity }   from '../src/identity/AgentIdentity.js';
import { VaultMemory }     from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { tokenGate }       from '../src/security/helloGates.js';

async function makePair() {
  const bus     = new InternalBus();
  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId   = await AgentIdentity.generate(new VaultMemory());
  const alice   = new Agent({ identity: aliceId, transport: new InternalTransport(bus, aliceId.pubKey, { identity: aliceId }) });
  const bob     = new Agent({ identity: bobId,   transport: new InternalTransport(bus, bobId.pubKey,   { identity: bobId   }) });
  await alice.start(); await bob.start();
  return { alice, bob };
}

describe('handleHello — default (no gate)', () => {
  it('accepts every hello (backward-compat)', async () => {
    const { alice, bob } = await makePair();
    await alice.hello(bob.address, 2_000);
    expect(bob.security.getPeerKey(alice.address)).toBeTruthy();
    expect(alice.security.getPeerKey(bob.address)).toBeTruthy();
    await alice.stop(); await bob.stop();
  });
});

describe('handleHello — gate rejects silently', () => {
  it('setHelloGate(() => false) → hello times out; no key registered', async () => {
    const { alice, bob } = await makePair();

    bob.setHelloGate(() => false);
    const peerEvents = [];
    bob.on('peer', e => peerEvents.push(e));

    await expect(alice.hello(bob.address, 200)).rejects.toThrow(/timeout/i);

    expect(peerEvents).toHaveLength(0);
    expect(bob.security.getPeerKey(alice.address)).toBeNull();
    // Alice never received an ack so her side is untouched as well.
    expect(alice.security.getPeerKey(bob.address)).toBeNull();

    await alice.stop(); await bob.stop();
  });

  it('gate that throws behaves the same as false (fail-closed)', async () => {
    const { alice, bob } = await makePair();
    bob.setHelloGate(() => { throw new Error('boom'); });

    await expect(alice.hello(bob.address, 200)).rejects.toThrow(/timeout/i);
    expect(bob.security.getPeerKey(alice.address)).toBeNull();

    await alice.stop(); await bob.stop();
  });

  it('async gate returning false is honoured', async () => {
    const { alice, bob } = await makePair();
    bob.setHelloGate(async () => false);

    await expect(alice.hello(bob.address, 200)).rejects.toThrow(/timeout/i);
    expect(bob.security.getPeerKey(alice.address)).toBeNull();

    await alice.stop(); await bob.stop();
  });
});

describe('handleHello — gate accepts', () => {
  it('gate returning true → normal flow completes', async () => {
    const { alice, bob } = await makePair();
    bob.setHelloGate(() => true);

    await alice.hello(bob.address, 2_000);
    expect(bob.security.getPeerKey(alice.address)).toBeTruthy();
    expect(alice.security.getPeerKey(bob.address)).toBeTruthy();

    await alice.stop(); await bob.stop();
  });
});

describe('handleHello — tokenGate end-to-end', () => {
  it('caller without the token → timeout, caller with token → success', async () => {
    const { alice, bob } = await makePair();
    bob.setHelloGate(tokenGate('family-key'));

    // Attempt without a token (or wrong token) — times out.
    await expect(alice.hello(bob.address, 200)).rejects.toThrow(/timeout/i);
    expect(bob.security.getPeerKey(alice.address)).toBeNull();

    // Monkey-patch Alice's sendHello to include the token in the payload.
    // (Real apps would do this via a thin wrapper around agent.hello.)
    const origSendHello = alice.transport.sendHello.bind(alice.transport);
    alice.transport.sendHello = (to, payload) =>
      origSendHello(to, { ...payload, authToken: 'family-key' });

    await alice.hello(bob.address, 2_000);
    expect(bob.security.getPeerKey(alice.address)).toBeTruthy();

    await alice.stop(); await bob.stop();
  });
});

describe('setHelloGate — argument validation', () => {
  it('accepts null to clear the gate', async () => {
    const { alice, bob } = await makePair();
    bob.setHelloGate(() => false);
    bob.setHelloGate(null);

    await alice.hello(bob.address, 2_000);
    expect(bob.security.getPeerKey(alice.address)).toBeTruthy();

    await alice.stop(); await bob.stop();
  });

  it('throws on a non-function / non-null argument', async () => {
    const { alice, bob } = await makePair();
    expect(() => bob.setHelloGate(42)).toThrow();
    expect(() => bob.setHelloGate('nope')).toThrow();
    await alice.stop(); await bob.stop();
  });
});
