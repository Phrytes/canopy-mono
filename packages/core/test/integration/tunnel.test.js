/**
 * Group CC integration — hop-aware task tunnel.
 *
 * Three-agent mesh: Alice and Carol share no transport; Bob bridges
 * them.  Exercises streaming, input-required, cancel, and the
 * fall-back-to-relay-forward path when Bob does not advertise
 * `tunnel: true`.
 *
 * Stays in one file (not bolted onto mesh-scenario.test.js) so the
 * peer-graph wiring can be minimal.
 */
import { describe, it, expect } from 'vitest';
import { Agent, AgentIdentity, PeerGraph, Parts, TextPart, DataPart, InternalBus, InternalTransport, Task, registerTunnelReceiveSealed, registerRelayReceiveSealed } from '../../src/index.js';
import { VaultMemory } from '@onderling/vault';

async function buildTunnelMesh({ withTunnel = true } = {}) {
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

  const alicePeers = new PeerGraph();
  const bobPeers   = new PeerGraph();
  const carolPeers = new PeerGraph();

  const alice = new Agent({ identity: aliceId, transport: aliceRelay, peers: alicePeers });
  const bob   = new Agent({ identity: bobId,   transport: bobRelay,   peers: bobPeers, routing: bobRouting });
  const carol = new Agent({ identity: carolId, transport: carolLoop,  peers: carolPeers });

  bob.addTransport('loop', bobLoop);

  // Pre-register keys so we don't need to drive hello over the transports.
  alice.addPeer(bobId.pubKey,   bobId.pubKey);
  bob.addPeer  (aliceId.pubKey, aliceId.pubKey);
  bob.addPeer  (carolId.pubKey, carolId.pubKey);
  carol.addPeer(bobId.pubKey,   bobId.pubKey);

  await alice.start(); await bob.start(); await carol.start();

  // Seed peer graph records.  Alice knows Bob as a tunnel-capable
  // direct peer and Carol as indirect via Bob.  Capabilities are
  // normally populated by hello; we seed them directly to avoid the
  // hello dance in a focused routing test.
  await alicePeers.upsert({
    pubKey:       bobId.pubKey,
    hops:         0,
    reachable:    true,
    capabilities: { tunnel: withTunnel, relay: true },
  });
  await alicePeers.upsert({
    pubKey:    carolId.pubKey,
    hops:      1,
    via:       bobId.pubKey,
    reachable: true,
  });
  await bobPeers.upsert({ pubKey: aliceId.pubKey, hops: 0, reachable: true });
  await bobPeers.upsert({ pubKey: carolId.pubKey, hops: 0, reachable: true });
  await carolPeers.upsert({ pubKey: bobId.pubKey, hops: 0, reachable: true });

  // Bob either hosts a tunnel bridge (CC2 path) or just relay-forward.
  if (withTunnel) bob.enableTunnelForward({ policy: 'always' });
  bob.enableRelayForward({ policy: 'always' });

  // Carol registers tunnel-receive-sealed so sealed tunnels can land,
  // and relay-receive-sealed so the one-shot sealed fallback also works
  // (used when Bob does not advertise the tunnel capability).
  registerTunnelReceiveSealed(carol);
  registerRelayReceiveSealed(carol);

  // Bob's outbound tap — wrap invoke + call so tests can see what got
  // forwarded (and whether the payload contains plaintext).
  const bobOutbound = [];
  const origBobInvoke = bob.invoke.bind(bob);
  bob.invoke = async (peerId, skillId, input, opts) => {
    bobOutbound.push({ peerId, skillId, payload: JSON.stringify(input) });
    return origBobInvoke(peerId, skillId, input, opts);
  };
  const origBobCall = bob.call.bind(bob);
  bob.call = (peerId, skillId, input, opts) => {
    bobOutbound.push({ peerId, skillId, payload: JSON.stringify(input) });
    return origBobCall(peerId, skillId, input, opts);
  };

  async function teardown() {
    await alice.stop(); await bob.stop(); await carol.stop();
  }

  return {
    alice, bob, carol,
    aliceId, bobId, carolId,
    pubKeys: { alice: aliceId.pubKey, bob: bobId.pubKey, carol: carolId.pubKey },
    bobOutbound,
    teardown,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Group CC — hop-aware task tunnel', () => {

  it('streams async-generator chunks end-to-end through a tunnel', async () => {
    const m = await buildTunnelMesh();

    m.carol.register('stream-3', async function* () {
      yield [TextPart('one')];
      yield [TextPart('two')];
      yield [TextPart('three')];
    });

    const task = m.alice.callWithHop(m.pubKeys.carol, 'stream-3', []);

    const chunks = [];
    for await (const c of task.stream()) chunks.push(Parts.text(c));

    const snap = await task.done();
    expect(snap.state).toBe('completed');
    expect(chunks).toEqual(['one', 'two', 'three']);

    await m.teardown();
  });

  it('input-required round-trips through the tunnel', async () => {
    const m = await buildTunnelMesh();

    m.carol.register('ask-name', async ({ parts }) => {
      if (Parts.text(parts) === 'start') {
        throw new Task.InputRequired([TextPart('Name?')]);
      }
      // Second pass — we get the user's reply.
      const name = Parts.text(parts);
      return [TextPart(`hi ${name}`)];
    });

    const task = m.alice.callWithHop(m.pubKeys.carol, 'ask-name', [TextPart('start')]);

    const irParts = await new Promise(res => task.once('input-required', res));
    expect(Parts.text(irParts)).toBe('Name?');

    await task.send([TextPart('the author')]);

    const snap = await task.done();
    expect(snap.state).toBe('completed');
    expect(Parts.text(snap.parts)).toBe('hi the author');

    await m.teardown();
  });

  it('cancel propagates from Alice to Carol through the tunnel', async () => {
    const m = await buildTunnelMesh();

    let sawAbort = false;
    m.carol.register('long-runner', async ({ signal }) => {
      // Poll for abort; respect signal.aborted.
      await new Promise((_, reject) => {
        const id = setInterval(() => {
          if (signal?.aborted) {
            sawAbort = true;
            clearInterval(id);
            reject(new Error('aborted'));
          }
        }, 20);
        signal?.addEventListener?.('abort', () => {
          sawAbort = true;
          clearInterval(id);
          reject(new Error('aborted'));
        });
      });
    });

    const task = m.alice.callWithHop(m.pubKeys.carol, 'long-runner', []);

    // Let the RQ reach Carol.
    await new Promise(r => setTimeout(r, 60));
    await task.cancel();

    // Give the cancel some time to flow Alice→Bob→Carol.
    await new Promise(r => setTimeout(r, 120));
    expect(sawAbort).toBe(true);
    expect(task.state).toBe('cancelled');

    await m.teardown();
  });

  it('falls back to one-shot relay-forward when the bridge does not advertise tunnel', async () => {
    const m = await buildTunnelMesh({ withTunnel: false });

    m.carol.register('echo', async ({ parts }) => [TextPart(`echo:${Parts.text(parts)}`)]);

    const task = m.alice.callWithHop(m.pubKeys.carol, 'echo', [TextPart('hi')]);
    const snap = await task.done();

    expect(snap.state).toBe('completed');
    expect(Parts.text(snap.parts)).toBe('echo:hi');

    // Tunnel session table should be empty — the tunnel path wasn't taken.
    expect(m.bob._tunnelSessions?.size ?? 0).toBe(0);

    await m.teardown();
  });

  it('invokeWithHop (Parts[] facade) still works via the tunnel', async () => {
    const m = await buildTunnelMesh();

    m.carol.register('double', async ({ parts }) => {
      const n = Number(Parts.text(parts));
      return [TextPart(String(n * 2))];
    });

    const out = await m.alice.invokeWithHop(m.pubKeys.carol, 'double', [TextPart('21')]);
    expect(Parts.text(out)).toBe('42');

    await m.teardown();
  });
});

// ── Sealed-tunnel variant (CC3b): BB + CC combined ────────────────────────────

describe('Group CC3b — sealed hop-aware task tunnel', () => {

  it('sealed streaming: async-generator chunks flow Alice ← Carol without Bob seeing plaintext', async () => {
    const m = await buildTunnelMesh();

    m.carol.register('slow-count-sealed', async function* () {
      yield [TextPart('alpha')];
      yield [TextPart('beta')];
      yield [TextPart('gamma')];
    });

    const task = m.alice.callWithHop(
      m.pubKeys.carol, 'slow-count-sealed', [],
      { sealed: true },
    );

    const chunks = [];
    for await (const c of task.stream()) chunks.push(Parts.text(c));
    const snap = await task.done();

    expect(snap.state).toBe('completed');
    expect(chunks).toEqual(['alpha', 'beta', 'gamma']);

    // Bob only ever saw opaque ciphertext — no plaintext in his
    // outbound tap.
    const anyPlaintext = m.bobOutbound.some(e =>
      e.payload.includes('alpha') || e.payload.includes('beta') || e.payload.includes('gamma'),
    );
    expect(anyPlaintext).toBe(false);

    // Bob went through tunnel-receive-sealed (the sealed tunnel delivery),
    // not the plaintext tunnel-forwarding path with the inner skill name.
    const receiveCall = m.bobOutbound.find(e => e.skillId === 'tunnel-receive-sealed');
    expect(receiveCall).toBeTruthy();
    const plainSkillCall = m.bobOutbound.find(e => e.skillId === 'slow-count-sealed');
    expect(plainSkillCall).toBeUndefined();

    await m.teardown();
  });

  it('sealed IR: input-required prompt round-trips with encrypted parts', async () => {
    const m = await buildTunnelMesh();

    m.carol.register('ask-secret', async ({ parts }) => {
      if (Parts.text(parts) === 'start') {
        throw new Task.InputRequired([TextPart('password?')]);
      }
      return [TextPart(`unlocked:${Parts.text(parts)}`)];
    });

    const task = m.alice.callWithHop(
      m.pubKeys.carol, 'ask-secret', [TextPart('start')],
      { sealed: true },
    );

    const irParts = await new Promise(res => task.once('input-required', res));
    expect(Parts.text(irParts)).toBe('password?');

    await task.send([TextPart('hunter2')]);
    const snap = await task.done();
    expect(snap.state).toBe('completed');
    expect(Parts.text(snap.parts)).toBe('unlocked:hunter2');

    // Neither the prompt nor the secret appear in Bob's outbound tap.
    const bobSawSecret = m.bobOutbound.some(e =>
      e.payload.includes('password?') || e.payload.includes('hunter2') || e.payload.includes('unlocked'),
    );
    expect(bobSawSecret).toBe(false);

    await m.teardown();
  });

  it('sealed cancel: Alice.cancel aborts Carol\'s handler via signal', async () => {
    const m = await buildTunnelMesh();

    let sawAbort = false;
    m.carol.register('long-sealed', async ({ signal }) => {
      await new Promise((_, reject) => {
        const id = setInterval(() => {
          if (signal?.aborted) { sawAbort = true; clearInterval(id); reject(new Error('aborted')); }
        }, 20);
        signal?.addEventListener?.('abort', () => {
          sawAbort = true; clearInterval(id); reject(new Error('aborted'));
        });
      });
    });

    const task = m.alice.callWithHop(
      m.pubKeys.carol, 'long-sealed', [],
      { sealed: true },
    );
    await new Promise(r => setTimeout(r, 60));
    await task.cancel();
    await new Promise(r => setTimeout(r, 120));

    expect(sawAbort).toBe(true);
    expect(task.state).toBe('cancelled');

    await m.teardown();
  });

  it('sealed group: opts.group with enableSealedForwardFor triggers the sealed-tunnel path', async () => {
    const m = await buildTunnelMesh();
    m.alice.enableSealedForwardFor('secret-chat');

    m.carol.register('echo-sealed', async ({ parts }) => [TextPart(`echo:${Parts.text(parts)}`)]);

    const out = await m.alice.invokeWithHop(
      m.pubKeys.carol, 'echo-sealed', [TextPart('classified')],
      { group: 'secret-chat' },
    );
    expect(Parts.text(out)).toBe('echo:classified');

    const bobSaw = m.bobOutbound.some(e => e.payload.includes('classified'));
    expect(bobSaw).toBe(false);

    await m.teardown();
  });

  it('sealed tunnel falls back to one-shot when bridge does not advertise tunnel', async () => {
    const m = await buildTunnelMesh({ withTunnel: false });

    m.carol.register('echo-sealed', async ({ parts }) => [TextPart(`echo:${Parts.text(parts)}`)]);

    const out = await m.alice.invokeWithHop(
      m.pubKeys.carol, 'echo-sealed', [TextPart('ping')],
      { sealed: true },
    );
    expect(Parts.text(out)).toBe('echo:ping');

    // Bob's outbound tap: in the one-shot sealed path Bob invokes
    // relay-receive-sealed on Carol (inbound relay-forward on Bob doesn't
    // show up in the outbound tap).  And tunnel-receive-sealed must NOT
    // appear — that would indicate the tunnel path was taken.
    const relaySealed = m.bobOutbound.find(e => e.skillId === 'relay-receive-sealed');
    expect(relaySealed).toBeTruthy();
    const tunnelSealed = m.bobOutbound.find(e => e.skillId === 'tunnel-receive-sealed');
    expect(tunnelSealed).toBeUndefined();

    // Tunnel session table should be empty — no tunnel was opened.
    expect(m.bob._tunnelSessions?.size ?? 0).toBe(0);

    await m.teardown();
  });
});
