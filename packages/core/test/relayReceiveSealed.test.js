/**
 * relay-receive-sealed skill + sealed branch in relay-forward (Group BB3).
 *
 * Covers the end-to-end blind-forward flow in a 3-agent mesh:
 *   Alice  ──relay bus──  Bob  ──loop bus──  Carol
 *
 * Alice seals a receive-message call for Carol; Bob runs relay-forward;
 * Carol runs relay-receive-sealed. Asserts:
 *   • Carol's handler runs with originVerified = true and originFrom = Alice.
 *   • Bob's task-handler events never exposed the inner `skill` or `parts`.
 *   • Sender-swap attempts are caught by Carol (security-warning + drop).
 *   • Plaintext relay-forward still works unchanged (backward compat).
 *
 * Ref: Design-v3/blind-forward.md §5, CODING-PLAN Group BB3.
 */
import { describe, it, expect } from 'vitest';
import {
  Agent, AgentIdentity, VaultMemory, PeerGraph,
  InternalBus, InternalTransport,
  TextPart, DataPart, Parts,
  registerRelayForward, registerRelayReceiveSealed,
  packSealed, signOrigin,
}                                 from '../src/index.js';

async function buildTriad() {
  // Alice  <— relay-bus —>  Bob  <— loop-bus —>  Carol
  const relayBus = new InternalBus();
  const loopBus  = new InternalBus();

  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId   = await AgentIdentity.generate(new VaultMemory());
  const carolId = await AgentIdentity.generate(new VaultMemory());

  const aliceRelay = new InternalTransport(relayBus, aliceId.pubKey, { identity: aliceId });
  const bobRelay   = new InternalTransport(relayBus, bobId.pubKey,   { identity: bobId });
  const bobLoop    = new InternalTransport(loopBus,  bobId.pubKey,   { identity: bobId });
  const carolLoop  = new InternalTransport(loopBus,  carolId.pubKey, { identity: carolId });

  const bobRouting = {
    selectTransport: (peerId) => {
      if (peerId === aliceId.pubKey) return { transport: bobRelay };
      if (peerId === carolId.pubKey) return { transport: bobLoop };
      return null;
    },
  };

  const alice = new Agent({ identity: aliceId, transport: aliceRelay, peers: new PeerGraph() });
  const bob   = new Agent({ identity: bobId,   transport: bobRelay,   peers: new PeerGraph(), routing: bobRouting });
  const carol = new Agent({ identity: carolId, transport: carolLoop,  peers: new PeerGraph() });

  bob.addTransport('loop', bobLoop);

  // Pre-register keys + peer graph to keep tests focused on the skill wiring.
  alice.addPeer(bob.address,   bob.pubKey);
  bob.addPeer  (alice.address, alice.pubKey);
  bob.addPeer  (carol.address, carol.pubKey);
  carol.addPeer(bob.address,   bob.pubKey);

  await alice.start(); await bob.start(); await carol.start();

  await bob.peers.upsert({ pubKey: alice.pubKey, hops: 0, reachable: true });
  await bob.peers.upsert({ pubKey: carol.pubKey, hops: 0, reachable: true });

  registerRelayForward     (bob,   { policy: 'always' });
  registerRelayReceiveSealed(carol);

  const received = [];
  const warnings = { carol: [], alice: [], bob: [] };
  carol.on('security-warning', w => warnings.carol.push(w));

  carol.register('receive-message', async ({ parts, from, originFrom, originVerified, relayedBy }) => {
    const text = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
    received.push({ text, from, originFrom, originVerified, relayedBy });
    return [DataPart({ ack: true })];
  }, { visibility: 'public' });

  return {
    alice, bob, carol, received, warnings,
    async teardown() {
      await alice.stop(); await bob.stop(); await carol.stop();
    },
  };
}

describe('blind-forward: sealed relay-forward branch', () => {
  it('happy path: Alice seals → Bob forwards → Carol dispatches with verified origin', async () => {
    const t = await buildTriad();

    // Build the sealed payload the way invokeWithHop will in BB4.
    const parts = [TextPart('hi carol (sealed)')];
    const { sig, originTs } = signOrigin(t.alice.identity, {
      target: t.carol.pubKey,
      skill:  'receive-message',
      parts,
    });
    const { sealed, nonce } = packSealed({
      identity:        t.alice.identity,
      recipientPubKey: t.carol.pubKey,
      skill:           'receive-message',
      parts,
      origin:          t.alice.pubKey,
      originSig:       sig,
      originTs,
    });

    // Alice asks Bob to relay-forward the sealed blob.
    const out = await t.alice.invoke(
      t.bob.address, 'relay-forward',
      [DataPart({
        targetPubKey: t.carol.pubKey,
        sealed, nonce,
      })],
    );
    const outData = Parts.data(out);
    expect(outData.forwarded).toBe(true);
    expect(outData.sealed).toBe(true);

    // Carol's receive-message ran.
    expect(t.received).toHaveLength(1);
    expect(t.received[0].text).toBe('hi carol (sealed)');
    expect(t.received[0].originFrom).toBe(t.alice.pubKey);
    expect(t.received[0].originVerified).toBe(true);
    expect(t.received[0].relayedBy).toBe(t.bob.pubKey);

    // No security-warning.
    expect(t.warnings.carol).toHaveLength(0);

    await t.teardown();
  });

  it('bridge swapping sender → Carol fires security-warning and drops', async () => {
    const t = await buildTriad();

    const parts = [TextPart('secret')];
    const { sig, originTs } = signOrigin(t.alice.identity, {
      target: t.carol.pubKey, skill: 'receive-message', parts,
    });
    const { sealed, nonce } = packSealed({
      identity:        t.alice.identity,
      recipientPubKey: t.carol.pubKey,
      skill:           'receive-message',
      parts,
      origin:          t.alice.pubKey,
      originSig:       sig,
      originTs,
    });

    // Simulate Bob-as-attacker: invoke relay-receive-sealed directly on
    // Carol with `sender: Bob` (claiming he is the origin) instead of
    // `sender: Alice`. nacl.box auth will fail because the shared key
    // wasn't derived from Bob's keypair.
    const result = await t.bob.invoke(
      t.carol.address, 'relay-receive-sealed',
      [DataPart({ sealed, nonce, sender: t.bob.pubKey })],
    );
    const data = Parts.data(result);
    expect(data?.error).toMatch(/seal-open-failed/);

    // Carol emitted a security-warning for the open failure.
    expect(t.warnings.carol).toHaveLength(1);
    expect(t.warnings.carol[0].kind).toBe('sealed-forward-open');

    // receive-message never ran.
    expect(t.received).toHaveLength(0);

    await t.teardown();
  });

  it('plaintext relay-forward (no `sealed` field) still works unchanged', async () => {
    const t = await buildTriad();

    const parts = [TextPart('plain hi')];
    const { sig, originTs } = signOrigin(t.alice.identity, {
      target: t.carol.pubKey, skill: 'receive-message', parts,
    });

    // Classic plaintext relay-forward (pre-BB).
    const out = await t.alice.invoke(
      t.bob.address, 'relay-forward',
      [DataPart({
        targetPubKey: t.carol.pubKey,
        skill:        'receive-message',
        payload:      parts,
        originSig:    sig,
        originTs,
      })],
    );
    const outData = Parts.data(out);
    expect(outData.forwarded).toBe(true);
    expect(outData.sealed).toBeUndefined();

    expect(t.received).toHaveLength(1);
    expect(t.received[0].text).toBe('plain hi');
    expect(t.received[0].originFrom).toBe(t.alice.pubKey);
    expect(t.received[0].originVerified).toBe(true);

    await t.teardown();
  });

  it('relay-forward rejects a request with neither skill nor sealed', async () => {
    const t = await buildTriad();

    const out = await t.alice.invoke(
      t.bob.address, 'relay-forward',
      [DataPart({ targetPubKey: t.carol.pubKey })],
    );
    expect(Parts.data(out).error).toMatch(/missing skill or sealed/);

    await t.teardown();
  });

  it('sealed request missing nonce is rejected cleanly', async () => {
    const t = await buildTriad();

    const out = await t.alice.invoke(
      t.bob.address, 'relay-forward',
      [DataPart({ targetPubKey: t.carol.pubKey, sealed: 'xxx' })],
    );
    expect(Parts.data(out).error).toMatch(/missing nonce/);

    await t.teardown();
  });
});

describe('blind-forward: bridge cannot observe plaintext parts', () => {
  it('Bob\'s task-handler events never see the inner skill id or parts', async () => {
    const t = await buildTriad();

    // Collect everything Bob sees via his skill-error / task hooks. For
    // the sealed path, Bob's task handler runs only the relay-forward
    // skill; the inner receive-message never touches Bob.
    const bobTouched = [];
    const origCallSkill = t.bob.skills.get('relay-forward').handler;
    // We're not replacing the handler; we're recording what arguments it
    // sees. Since relay-forward is what Alice invokes, we confirm that
    // the parts it receives contain `sealed` (opaque) and do NOT contain
    // plaintext `skill` / `payload`.

    const parts = [TextPart('should be hidden from Bob')];
    const { sig, originTs } = signOrigin(t.alice.identity, {
      target: t.carol.pubKey, skill: 'receive-message', parts,
    });
    const { sealed, nonce } = packSealed({
      identity:        t.alice.identity,
      recipientPubKey: t.carol.pubKey,
      skill:           'receive-message',
      parts,
      origin:          t.alice.pubKey,
      originSig:       sig,
      originTs,
    });

    // Tap Bob's incoming task dispatch to record what he sees.
    t.bob.on('skill-called', ev => bobTouched.push(ev));

    await t.alice.invoke(
      t.bob.address, 'relay-forward',
      [DataPart({ targetPubKey: t.carol.pubKey, sealed, nonce })],
    );

    // Nothing Bob recorded contains the text — the seal is opaque to him.
    const bobSawPlaintext = JSON.stringify(bobTouched).includes('should be hidden');
    expect(bobSawPlaintext).toBe(false);

    // And Carol actually got the text (just to be sure the test isn't broken).
    expect(t.received[0].text).toBe('should be hidden from Bob');

    await t.teardown();
  });
});
