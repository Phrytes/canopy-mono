/**
 * features.test.js — integration tests for the five new features:
 *
 *   3. PubSub history
 *   4. Multi-round InputRequired
 *   5. AbortSignal / cancellation
 *   6. Task expiry (TTL)
 *   7. requires-token policy
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent }            from '../src/Agent.js';
import { AgentIdentity }    from '../src/identity/AgentIdentity.js';
import { VaultMemory }      from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, DataPart, Parts } from '../src/Parts.js';
import { Task }             from '../src/protocol/Task.js';
import { subscribe }        from '../src/protocol/pubSub.js';
import { TrustRegistry }    from '../src/permissions/TrustRegistry.js';
import { PolicyEngine }     from '../src/permissions/PolicyEngine.js';
import { CapabilityToken }  from '../src/permissions/CapabilityToken.js';
import { TokenRegistry }    from '../src/permissions/TokenRegistry.js';
import { defineSkill }      from '../src/skills/defineSkill.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makePair(aliceOpts = {}, bobOpts = {}) {
  const bus     = new InternalBus();
  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId   = await AgentIdentity.generate(new VaultMemory());
  const alice   = new Agent({ identity: aliceId, transport: new InternalTransport(bus, aliceId.pubKey), ...aliceOpts });
  const bob     = new Agent({ identity: bobId,   transport: new InternalTransport(bus, bobId.pubKey),   ...bobOpts });
  alice.addPeer(bob.address,   bob.pubKey);
  bob.addPeer(alice.address,   alice.pubKey);
  await alice.start();
  await bob.start();
  return { alice, bob, aliceId, bobId };
}

// ── 3. PubSub history ─────────────────────────────────────────────────────────

describe('pubSub history', () => {
  it('new subscriber receives replayed history', async () => {
    const { alice, bob } = await makePair({}, { pubSubHistory: 5 });

    // Bob publishes 3 messages BEFORE alice subscribes.
    await bob.publish('news', 'first');
    await bob.publish('news', 'second');
    await bob.publish('news', 'third');
    await new Promise(r => setTimeout(r, 10));

    // Alice subscribes after the fact.
    const received = [];
    await subscribe(alice, bob.address, 'news', parts => received.push(Parts.text(parts)));
    await new Promise(r => setTimeout(r, 30));

    expect(received).toEqual(['first', 'second', 'third']);
  });

  it('history is capped at pubSubHistory messages', async () => {
    const { alice, bob } = await makePair({}, { pubSubHistory: 2 });

    await bob.publish('feed', 'a');
    await bob.publish('feed', 'b');
    await bob.publish('feed', 'c');  // 'a' should be evicted
    await new Promise(r => setTimeout(r, 10));

    const received = [];
    await subscribe(alice, bob.address, 'feed', parts => received.push(Parts.text(parts)));
    await new Promise(r => setTimeout(r, 20));

    expect(received).toEqual(['b', 'c']);
  });

  it('no history replayed when pubSubHistory is 0 (default)', async () => {
    const { alice, bob } = await makePair();  // default: pubSubHistory = 0

    await bob.publish('ch', 'old');
    await new Promise(r => setTimeout(r, 10));

    const received = [];
    await subscribe(alice, bob.address, 'ch', parts => received.push(Parts.text(parts)));
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(0);
  });

  it('clearPubSubHistory(topic) clears only that topic', async () => {
    const { alice, bob } = await makePair({}, { pubSubHistory: 10 });

    await bob.publish('a', 'msg-a');
    await bob.publish('b', 'msg-b');
    await new Promise(r => setTimeout(r, 10));

    bob.clearPubSubHistory('a');

    const recA = [], recB = [];
    await subscribe(alice, bob.address, 'a', p => recA.push(Parts.text(p)));
    await subscribe(alice, bob.address, 'b', p => recB.push(Parts.text(p)));
    await new Promise(r => setTimeout(r, 20));

    expect(recA).toHaveLength(0);
    expect(recB).toEqual(['msg-b']);
  });

  it('clearPubSubHistory() with no arg clears all topics', async () => {
    const { alice, bob } = await makePair({}, { pubSubHistory: 10 });

    await bob.publish('x', 'old-x');
    await bob.publish('y', 'old-y');
    await new Promise(r => setTimeout(r, 10));

    bob.clearPubSubHistory();

    const recX = [], recY = [];
    await subscribe(alice, bob.address, 'x', p => recX.push(p));
    await subscribe(alice, bob.address, 'y', p => recY.push(p));
    await new Promise(r => setTimeout(r, 20));

    expect(recX).toHaveLength(0);
    expect(recY).toHaveLength(0);
  });

  it('live messages still delivered after history replay', async () => {
    const { alice, bob } = await makePair({}, { pubSubHistory: 5 });

    await bob.publish('live', 'historical');
    await new Promise(r => setTimeout(r, 10));

    const received = [];
    await subscribe(alice, bob.address, 'live', parts => received.push(Parts.text(parts)));
    await new Promise(r => setTimeout(r, 20));

    await bob.publish('live', 'new');
    await new Promise(r => setTimeout(r, 20));

    expect(received).toEqual(['historical', 'new']);
  });
});

// ── 4. Multi-round InputRequired ─────────────────────────────────────────────

describe('multi-round InputRequired', () => {
  it('two rounds: name then password', async () => {
    const { alice, bob } = await makePair();

    bob.register('wizard', async ({ parts }) => {
      const text = Parts.text(parts) ?? '';
      if (!text)          throw new Task.InputRequired([TextPart('Name?')]);
      if (text === 'admin') throw new Task.InputRequired([TextPart('Password?')]);
      return [TextPart(`Welcome, ${text}`)];
    });

    const task = alice.call(bob.address, 'wizard', []);

    // Round 1: empty → ask for name
    const q1 = await new Promise(r => task.once('input-required', r));
    expect(Parts.text(q1)).toBe('Name?');

    // Set up round-2 listener BEFORE sending so we don't miss the event
    // (the inbound handler fires the second IR as a microtask synchronously
    // with the sendOneWay resolution, before our await resumes here).
    const q2Promise = new Promise(r => task.once('input-required', r));
    await task.send([TextPart('admin')]);

    // Round 2: 'admin' → ask for password
    const q2 = await q2Promise;
    expect(Parts.text(q2)).toBe('Password?');
    await task.send([TextPart('secret')]);

    const result = await task.done();
    expect(result.state).toBe('completed');
    expect(Parts.text(result.parts)).toBe('Welcome, secret');
  }, 10_000);

  it('three rounds accumulate context across calls', async () => {
    const { alice, bob } = await makePair();
    const seen = [];

    bob.register('accumulate', async ({ parts }) => {
      const val = Parts.text(parts) ?? '';
      seen.push(val);
      if (seen.length < 3) throw new Task.InputRequired([TextPart(`round ${seen.length + 1}`)]);
      return [TextPart(seen.join(','))];
    });

    const task = alice.call(bob.address, 'accumulate', [TextPart('a')]);

    await new Promise(r => task.once('input-required', r));
    const ir2Promise = new Promise(r => task.once('input-required', r));
    await task.send([TextPart('b')]);
    await ir2Promise;
    await task.send([TextPart('c')]);

    const result = await task.done();
    expect(Parts.text(result.parts)).toBe('a,b,c');
  }, 10_000);
});

// ── 5. AbortSignal / cancellation ─────────────────────────────────────────────

describe('task cancellation (AbortSignal)', () => {
  it('cancel() stops a streaming generator', async () => {
    const { alice, bob } = await makePair();
    const yielded = [];

    bob.register('slow-stream', async function* ({ signal }) {
      for (let i = 0; i < 10; i++) {
        if (signal?.aborted) return;
        yield [TextPart(`chunk-${i}`)];
        // Simulate async work between chunks.
        await new Promise(r => setTimeout(r, 20));
      }
    });

    const task   = alice.call(bob.address, 'slow-stream', []);
    const chunks = [];

    // Collect chunks until we cancel.
    const streamDone = (async () => {
      for await (const c of task.stream()) chunks.push(Parts.text(c));
    })();

    // Wait for at least one chunk then cancel.
    await new Promise(r => task.once('stream-chunk', r));
    await task.cancel();

    await streamDone;
    // We got at least one chunk but not all ten.
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(10);
    expect(task.state).toBe('cancelled');
  }, 10_000);

  it('ctx.signal is passed to handler', async () => {
    const { alice, bob } = await makePair();
    let receivedSignal = null;

    bob.register('signal-check', async ({ signal }) => {
      receivedSignal = signal;
      return [TextPart('ok')];
    });

    await alice.invoke(bob.address, 'signal-check', []);
    await new Promise(r => setTimeout(r, 10));

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });
});

// ── 6. Task expiry ────────────────────────────────────────────────────────────

describe('task expiry (TTL)', () => {
  it('caller task transitions to expired when receiver TTL fires', async () => {
    const { alice, bob } = await makePair({}, { maxTaskTtl: 100 });

    bob.register('slow', async () => {
      await new Promise(r => setTimeout(r, 5_000));  // never finishes in time
      return [TextPart('done')];
    });

    const task   = alice.call(bob.address, 'slow', [], { timeout: 3_000 });
    const result = await task.done();
    expect(result.state).toBe('expired');
  }, 5_000);

  it('caller TTL cap is respected by receiver', async () => {
    // Alice requests ttl=50ms; receiver has no ceiling → 50ms fires
    const { alice, bob } = await makePair();

    bob.register('slow2', async () => {
      await new Promise(r => setTimeout(r, 5_000));
      return [TextPart('done')];
    });

    const task   = alice.call(bob.address, 'slow2', [], { ttl: 100, timeout: 3_000 });
    const result = await task.done();
    expect(result.state).toBe('expired');
  }, 5_000);

  it('receiver maxTaskTtl caps a longer caller TTL', async () => {
    // Alice asks for ttl=10 000ms but receiver caps at 100ms.
    const { alice, bob } = await makePair({}, { maxTaskTtl: 100 });

    bob.register('slow3', async () => {
      await new Promise(r => setTimeout(r, 5_000));
      return [TextPart('done')];
    });

    const task   = alice.call(bob.address, 'slow3', [], { ttl: 10_000, timeout: 3_000 });
    const result = await task.done();
    expect(result.state).toBe('expired');
  }, 5_000);

  it('fast task completes before TTL fires', async () => {
    const { alice, bob } = await makePair({}, { maxTaskTtl: 2_000 });

    bob.register('fast', async ({ parts }) => parts);

    const task   = alice.call(bob.address, 'fast', [TextPart('hi')]);
    const result = await task.done();
    expect(result.state).toBe('completed');
    expect(Parts.text(result.parts)).toBe('hi');
  });

  it('expired state is a terminal state (done() resolves, not rejects)', async () => {
    const { alice, bob } = await makePair({}, { maxTaskTtl: 80 });

    bob.register('hang', async () => new Promise(() => {}));  // never resolves

    const task = alice.call(bob.address, 'hang', [], { timeout: 3_000 });
    await expect(task.done()).resolves.toMatchObject({ state: 'expired' });
  }, 5_000);
});

// ── 7. requires-token policy ──────────────────────────────────────────────────

describe('requires-token policy', () => {
  async function makePolicyPair() {
    const bus      = new InternalBus();
    const aliceId  = await AgentIdentity.generate(new VaultMemory());
    const bobId    = await AgentIdentity.generate(new VaultMemory());
    const carolId  = await AgentIdentity.generate(new VaultMemory());  // trusted issuer

    const bobVault    = new VaultMemory();
    const aliceVault  = new VaultMemory();
    const trustReg    = new TrustRegistry(bobVault);
    const tokenReg    = new TokenRegistry(aliceVault);

    // Carol is trusted by Bob.
    await trustReg.setTier(carolId.pubKey, 'trusted');

    const alice = new Agent({
      identity:      aliceId,
      transport:     new InternalTransport(bus, aliceId.pubKey),
      tokenRegistry: tokenReg,
    });

    const policyEngine = new PolicyEngine({
      trustRegistry: trustReg,
      skillRegistry: null,   // will be replaced after registration via skills getter
      agentPubKey:   bobId.pubKey,
    });

    const bob = new Agent({
      identity:      bobId,
      transport:     new InternalTransport(bus, bobId.pubKey),
      trustRegistry: trustReg,
      policyEngine:  new PolicyEngine({
        trustRegistry: trustReg,
        skillRegistry: { get: (id) => bob.skills.get(id) },  // lazy proxy
        agentPubKey:   bobId.pubKey,
      }),
    });

    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);
    await alice.start();
    await bob.start();

    return { alice, bob, aliceId, bobId, carolId, tokenReg, trustReg };
  }

  it('call without token is rejected with NO_TOKEN', async () => {
    const { alice, bob } = await makePolicyPair();

    bob.register('secret', async () => [TextPart('classified')], {
      policy: 'requires-token',
    });

    await expect(alice.invoke(bob.address, 'secret', [])).rejects.toThrow(/requires a capability token/);
  });

  it('call with valid token is allowed', async () => {
    const { alice, bob, aliceId, bobId, carolId, tokenReg } = await makePolicyPair();

    bob.register('secret', async () => [TextPart('classified')], {
      policy: 'requires-token',
    });

    // Carol issues a token granting Alice access to 'secret' on Bob.
    const token = await CapabilityToken.issue(carolId, {
      subject:  aliceId.pubKey,
      agentId:  bobId.pubKey,
      skill:    'secret',
      expiresIn: 60_000,
    });
    await tokenReg.store(token);

    const result = await alice.invoke(bob.address, 'secret', []);
    expect(Parts.text(result)).toBe('classified');
  }, 10_000);

  it('token with wrong subject is rejected', async () => {
    const { alice, bob, bobId, carolId, tokenReg } = await makePolicyPair();
    const thirdId = await AgentIdentity.generate(new VaultMemory());

    bob.register('secret', async () => [TextPart('ok')], { policy: 'requires-token' });

    // Token issued for a DIFFERENT subject (thirdId, not alice).
    const token = await CapabilityToken.issue(carolId, {
      subject:  thirdId.pubKey,   // wrong subject
      agentId:  bobId.pubKey,
      skill:    'secret',
      expiresIn: 60_000,
    });
    await tokenReg.store(token);

    await expect(alice.invoke(bob.address, 'secret', [])).rejects.toThrow(/subject does not match/);
  }, 10_000);

  it('wildcard token (*) grants access to any skill', async () => {
    const { alice, bob, aliceId, bobId, carolId, tokenReg } = await makePolicyPair();

    bob.register('a', async () => [TextPart('A')], { policy: 'requires-token' });
    bob.register('b', async () => [TextPart('B')], { policy: 'requires-token' });

    const token = await CapabilityToken.issue(carolId, {
      subject:  aliceId.pubKey,
      agentId:  bobId.pubKey,
      skill:    '*',
      expiresIn: 60_000,
    });
    await tokenReg.store(token);

    expect(Parts.text(await alice.invoke(bob.address, 'a', []))).toBe('A');
    expect(Parts.text(await alice.invoke(bob.address, 'b', []))).toBe('B');
  }, 10_000);

  it('token from untrusted issuer is rejected', async () => {
    const { alice, bob, aliceId, bobId, tokenReg } = await makePolicyPair();
    const untrustedId = await AgentIdentity.generate(new VaultMemory());
    // untrustedId is NOT in bob's TrustRegistry at trusted tier

    bob.register('secret', async () => [TextPart('ok')], { policy: 'requires-token' });

    const token = await CapabilityToken.issue(untrustedId, {
      subject:  aliceId.pubKey,
      agentId:  bobId.pubKey,
      skill:    'secret',
      expiresIn: 60_000,
    });
    await tokenReg.store(token);

    await expect(alice.invoke(bob.address, 'secret', [])).rejects.toThrow(/not trusted/);
  }, 10_000);

  it('server rejects expired token (bypassing client-side filter)', async () => {
    // TokenRegistry.get() filters out expired tokens client-side, so we need a mock
    // tokenRegistry that always returns the token to test server-side enforcement.
    const bus     = new InternalBus();
    const aliceId = await AgentIdentity.generate(new VaultMemory());
    const bobId   = await AgentIdentity.generate(new VaultMemory());
    const carolId = await AgentIdentity.generate(new VaultMemory());

    const trustReg = new TrustRegistry(new VaultMemory());
    await trustReg.setTier(carolId.pubKey, 'trusted');

    const expiredToken = await CapabilityToken.issue(carolId, {
      subject:   aliceId.pubKey,
      agentId:   bobId.pubKey,
      skill:     'secret',
      expiresIn: -1_000,
    });

    const alice = new Agent({
      identity:      aliceId,
      transport:     new InternalTransport(bus, aliceId.pubKey),
      tokenRegistry: { get: async () => expiredToken },  // always returns it
    });
    const bob = new Agent({
      identity:      bobId,
      transport:     new InternalTransport(bus, bobId.pubKey),
      trustRegistry: trustReg,
      policyEngine:  new PolicyEngine({
        trustRegistry: trustReg,
        skillRegistry: { get: (id) => bob.skills.get(id) },
        agentPubKey:   bobId.pubKey,
      }),
    });

    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);
    await alice.start();
    await bob.start();

    bob.register('secret', async () => [TextPart('ok')], { policy: 'requires-token' });

    await expect(alice.invoke(bob.address, 'secret', [])).rejects.toThrow(/expired|invalid/i);
  }, 10_000);

  it('server rejects token issued for wrong skill', async () => {
    const bus     = new InternalBus();
    const aliceId = await AgentIdentity.generate(new VaultMemory());
    const bobId   = await AgentIdentity.generate(new VaultMemory());
    const carolId = await AgentIdentity.generate(new VaultMemory());

    const trustReg = new TrustRegistry(new VaultMemory());
    await trustReg.setTier(carolId.pubKey, 'trusted');

    // Token grants 'other-skill', not 'secret'.
    const wrongToken = await CapabilityToken.issue(carolId, {
      subject:   aliceId.pubKey,
      agentId:   bobId.pubKey,
      skill:     'other-skill',
      expiresIn: 60_000,
    });

    const alice = new Agent({
      identity:      aliceId,
      transport:     new InternalTransport(bus, aliceId.pubKey),
      tokenRegistry: { get: async () => wrongToken },  // bypasses skill filter
    });
    const bob = new Agent({
      identity:      bobId,
      transport:     new InternalTransport(bus, bobId.pubKey),
      trustRegistry: trustReg,
      policyEngine:  new PolicyEngine({
        trustRegistry: trustReg,
        skillRegistry: { get: (id) => bob.skills.get(id) },
        agentPubKey:   bobId.pubKey,
      }),
    });

    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);
    await alice.start();
    await bob.start();

    bob.register('secret', async () => [TextPart('ok')], { policy: 'requires-token' });

    await expect(alice.invoke(bob.address, 'secret', [])).rejects.toThrow(/grants skill/);
  }, 10_000);
});

// ── 8. Cancel / expiry while waiting for InputRequired ────────────────────────

describe('cancel/expiry during InputRequired', () => {
  it('cancel() while handler is paused for input unblocks cleanly', async () => {
    const { alice, bob } = await makePair();

    bob.register('ask', async ({ parts }) => {
      const text = Parts.text(parts) ?? '';
      if (!text) throw new Task.InputRequired([TextPart('Give me something')]);
      return [TextPart(`got: ${text}`)];
    });

    const task = alice.call(bob.address, 'ask', []);

    // Wait for the input-required prompt.
    await new Promise(r => task.once('input-required', r));
    expect(task.state).toBe('input-required');

    // Cancel instead of providing input.
    await task.cancel();

    const result = await task.done();
    expect(result.state).toBe('cancelled');
  }, 10_000);

  it('TTL expiry while handler is waiting for input transitions to expired', async () => {
    // Bob has a 200ms task ceiling.
    const { alice, bob } = await makePair({}, { maxTaskTtl: 200 });

    bob.register('ask2', async ({ parts }) => {
      const text = Parts.text(parts) ?? '';
      if (!text) throw new Task.InputRequired([TextPart('Input please')]);
      return [TextPart(`got: ${text}`)];
    });

    const task = alice.call(bob.address, 'ask2', [], { timeout: 5_000 });

    // Wait for the input-required prompt, then do nothing — let the TTL fire.
    await new Promise(r => task.once('input-required', r));

    const result = await task.done();
    expect(result.state).toBe('expired');
  }, 5_000);
});

// ── 9. PubSub: multiple independent subscribers ───────────────────────────────

describe('pubSub multiple subscribers', () => {
  it('two subscribers each receive both history replay and live messages', async () => {
    const bus    = new InternalBus();
    const pubId  = await AgentIdentity.generate(new VaultMemory());
    const sub1Id = await AgentIdentity.generate(new VaultMemory());
    const sub2Id = await AgentIdentity.generate(new VaultMemory());

    const pub  = new Agent({ identity: pubId,  transport: new InternalTransport(bus, pubId.pubKey),  pubSubHistory: 3 });
    const sub1 = new Agent({ identity: sub1Id, transport: new InternalTransport(bus, sub1Id.pubKey) });
    const sub2 = new Agent({ identity: sub2Id, transport: new InternalTransport(bus, sub2Id.pubKey) });

    pub.addPeer(sub1.address, sub1.pubKey);  pub.addPeer(sub2.address, sub2.pubKey);
    sub1.addPeer(pub.address, pub.pubKey);   sub2.addPeer(pub.address, pub.pubKey);
    await pub.start(); await sub1.start(); await sub2.start();

    // Publish one historical message.
    await pub.publish('ch', 'old');
    await new Promise(r => setTimeout(r, 10));

    const rec1 = [], rec2 = [];
    await subscribe(sub1, pub.address, 'ch', p => rec1.push(Parts.text(p)));
    await subscribe(sub2, pub.address, 'ch', p => rec2.push(Parts.text(p)));
    await new Promise(r => setTimeout(r, 20));

    // Publish a new message after both subscribed.
    await pub.publish('ch', 'new');
    await new Promise(r => setTimeout(r, 20));

    expect(rec1).toEqual(['old', 'new']);
    expect(rec2).toEqual(['old', 'new']);
  });
});
