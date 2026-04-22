/**
 * Sealed-forward integration via invokeWithHop + agent API (Group BB4).
 *
 * Covers:
 *   • enableSealedForwardFor / disableSealedForwardFor / getSealedForwardConfig
 *   • per-call `opts.sealed` override
 *   • per-group enable triggers sealed path for invokeWithHop hop-routed sends
 *   • direct-delivery bypass still pays zero overhead (no seal, no relay)
 *   • disabling the group falls back to plaintext
 *   • telemetry: `sealed-forward-sent` (sender) + `sealed-forward-received` (target)
 *
 * Ref: Design-v3/blind-forward.md §5-§7, CODING-PLAN Group BB4.
 */
import { describe, it, expect } from 'vitest';
import {
  Agent, AgentIdentity, VaultMemory, PeerGraph,
  InternalBus, InternalTransport,
  TextPart, DataPart, Parts,
  registerRelayForward, registerRelayReceiveSealed,
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

  alice.addPeer(bob.address,   bob.pubKey);
  bob.addPeer  (alice.address, alice.pubKey);
  bob.addPeer  (carol.address, carol.pubKey);
  carol.addPeer(bob.address,   bob.pubKey);

  await alice.start(); await bob.start(); await carol.start();

  // Seed the PeerGraph so Alice considers Carol reachable via Bob.
  await alice.peers.upsert({ pubKey: bob.pubKey,   hops: 0, reachable: true });
  await alice.peers.upsert({ pubKey: carol.pubKey, hops: 1, via: bob.pubKey, reachable: true });
  await bob.peers.upsert  ({ pubKey: alice.pubKey, hops: 0, reachable: true });
  await bob.peers.upsert  ({ pubKey: carol.pubKey, hops: 0, reachable: true });

  registerRelayForward     (bob,   { policy: 'always' });
  registerRelayReceiveSealed(carol);

  const received    = [];
  carol.register('receive-message', async ({ parts, from, originFrom, originVerified, relayedBy }) => {
    received.push({
      text: Parts.text(parts) ?? JSON.stringify(Parts.data(parts)),
      from, originFrom, originVerified, relayedBy,
    });
    return [DataPart({ ack: true })];
  }, { visibility: 'public' });

  // Tap Bob's invoke — relay-forward calls agent.invoke internally to
  // deliver to the target. The *skill id* Bob invokes tells us whether
  // Alice sent plaintext (→ receive-message) or sealed (→ relay-receive-sealed).
  // The *parts* tell us whether the plaintext text is visible to Bob.
  const bobOutbound = [];
  const origBobInvoke = bob.invoke.bind(bob);
  bob.invoke = async (peerId, skillId, input, opts) => {
    bobOutbound.push({
      peerId, skillId,
      payload: JSON.stringify(input),
    });
    return origBobInvoke(peerId, skillId, input, opts);
  };

  return {
    alice, bob, carol, received, bobOutbound,
    async teardown() {
      await alice.stop(); await bob.stop(); await carol.stop();
    },
  };
}

describe('enableSealedForwardFor (Agent API)', () => {
  it('enable / disable / get round-trip', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const a  = new Agent({ identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey, { identity: id }) });
    expect(a.getSealedForwardConfig('g1')).toBeNull();
    a.enableSealedForwardFor('g1');
    expect(a.getSealedForwardConfig('g1')).toMatchObject({ enabled: true });
    a.disableSealedForwardFor('g1');
    expect(a.getSealedForwardConfig('g1')).toBeNull();
  });

  it('throws without a groupId', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const a  = new Agent({ identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey, { identity: id }) });
    expect(() => a.enableSealedForwardFor('')).toThrow(/groupId required/);
  });
});

describe('invokeWithHop — sealed by per-group config', () => {
  it('sends sealed when group is enabled; bridge never sees plaintext parts', async () => {
    const t = await buildTriad();
    t.alice.enableSealedForwardFor('home');

    let sentEvt = null;
    t.alice.on('sealed-forward-sent', e => { sentEvt = e; });
    let recvEvt = null;
    t.carol.on('sealed-forward-received', e => { recvEvt = e; });

    await t.alice.invokeWithHop(
      t.carol.pubKey, 'receive-message',
      [TextPart('hi via sealed')],
      { group: 'home' },
    );

    expect(t.received[0].text).toBe('hi via sealed');
    expect(t.received[0].originFrom).toBe(t.alice.pubKey);
    expect(t.received[0].originVerified).toBe(true);

    expect(sentEvt?.target).toBe(t.carol.pubKey);
    expect(recvEvt?.origin).toBe(t.alice.pubKey);

    // Bob's outbound invoke targeted relay-receive-sealed — not the raw
    // skill — and the forwarded payload contains no plaintext text.
    const forwardCall = t.bobOutbound.find(e => e.peerId === t.carol.pubKey);
    expect(forwardCall?.skillId).toBe('relay-receive-sealed');
    expect(forwardCall?.payload.includes('hi via sealed')).toBe(false);

    await t.teardown();
  });

  it('opts.sealed: true forces sealing without a group enrollment', async () => {
    const t = await buildTriad();
    // No enableSealedForwardFor — per-call override only.

    await t.alice.invokeWithHop(
      t.carol.pubKey, 'receive-message',
      [TextPart('opt-in per call')],
      { sealed: true },
    );

    expect(t.received[0].text).toBe('opt-in per call');
    expect(t.received[0].originVerified).toBe(true);

    const forwardCall = t.bobOutbound.find(e => e.peerId === t.carol.pubKey);
    expect(forwardCall?.skillId).toBe('relay-receive-sealed');
    expect(forwardCall?.payload.includes('opt-in per call')).toBe(false);

    await t.teardown();
  });
});

describe('invokeWithHop — non-sealed fall-through paths', () => {
  it('group disabled → plaintext relay-forward (backward compat)', async () => {
    const t = await buildTriad();
    // group 'work' is NOT enabled on alice.

    await t.alice.invokeWithHop(
      t.carol.pubKey, 'receive-message',
      [TextPart('plain text works')],
      { group: 'work' },
    );

    expect(t.received[0].text).toBe('plain text works');
    // Bob forwarded to the raw skill, and the payload does contain the
    // plaintext — backward-compat mode.
    const forwardCall = t.bobOutbound.find(e => e.peerId === t.carol.pubKey);
    expect(forwardCall?.skillId).toBe('receive-message');
    expect(forwardCall?.payload.includes('plain text works')).toBe(true);

    await t.teardown();
  });

  it('disabling mid-session falls back to plaintext for the next send', async () => {
    const t = await buildTriad();
    t.alice.enableSealedForwardFor('home');

    await t.alice.invokeWithHop(
      t.carol.pubKey, 'receive-message',
      [TextPart('m1 sealed')],
      { group: 'home' },
    );
    const fwd1 = t.bobOutbound.find(e => e.peerId === t.carol.pubKey);
    expect(fwd1?.skillId).toBe('relay-receive-sealed');
    expect(fwd1?.payload.includes('m1 sealed')).toBe(false);

    t.alice.disableSealedForwardFor('home');
    t.bobOutbound.length = 0;

    await t.alice.invokeWithHop(
      t.carol.pubKey, 'receive-message',
      [TextPart('m2 plain')],
      { group: 'home' },
    );
    const fwd2 = t.bobOutbound.find(e => e.peerId === t.carol.pubKey);
    expect(fwd2?.skillId).toBe('receive-message');
    expect(fwd2?.payload.includes('m2 plain')).toBe(true);

    await t.teardown();
  });
});
