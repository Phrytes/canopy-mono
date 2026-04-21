/**
 * session.js tests — built-in session-open / session-message / session-close skills.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent }         from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, DataPart, Parts } from '../src/Parts.js';
import { registerSessionSkills } from '../src/protocol/session.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

async function makePair() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);
  const alice = new Agent({ identity: idA, transport: tA, label: 'alice' });
  const bob   = new Agent({ identity: idB, transport: tB, label: 'bob' });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  // Register session skills on both sides.
  registerSessionSkills(alice);
  registerSessionSkills(bob);
  await alice.start(); await bob.start();
  return { alice, bob };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('session lifecycle', () => {
  it('session-open returns a sessionId', async () => {
    const { alice, bob } = await makePair();

    const result = await alice.invoke(bob.address, 'session-open', [TextPart('hello')]);
    const { sessionId } = Parts.data(result);
    expect(sessionId).toBeTypeOf('string');
    expect(sessionId.length).toBeGreaterThan(8);

    await alice.stop(); await bob.stop();
  });

  it('bob emits session-open event with correct fields', async () => {
    const { alice, bob } = await makePair();

    const opened = new Promise(r => bob.once('session-open', r));
    const result = await alice.invoke(bob.address, 'session-open', [TextPart('init')]);
    const { sessionId } = Parts.data(result);

    const evt = await opened;
    expect(evt.sessionId).toBe(sessionId);
    expect(evt.from).toBe(alice.address);

    await alice.stop(); await bob.stop();
  });

  it('session-message delivers message and bob emits event', async () => {
    const { alice, bob } = await makePair();

    const result = await alice.invoke(bob.address, 'session-open', []);
    const { sessionId } = Parts.data(result);

    const msgEvt = new Promise(r => bob.once('session-message', r));
    const ack = await alice.invoke(bob.address, 'session-message', [
      DataPart({ sessionId }), TextPart('hello from alice'),
    ]);
    expect(Parts.data(ack)?.ok).toBe(true);

    const evt = await msgEvt;
    expect(evt.sessionId).toBe(sessionId);
    expect(evt.from).toBe(alice.address);

    await alice.stop(); await bob.stop();
  });

  it('session-message fails gracefully for unknown sessionId', async () => {
    const { alice, bob } = await makePair();

    const result = await alice.invoke(bob.address, 'session-message', [
      DataPart({ sessionId: 'no-such-id' }),
    ]);
    const d = Parts.data(result);
    expect(d.ok).toBe(false);
    expect(d.error).toContain('not-found');

    await alice.stop(); await bob.stop();
  });

  it('session-close removes session from StateManager and emits event', async () => {
    const { alice, bob } = await makePair();

    const result = await alice.invoke(bob.address, 'session-open', []);
    const { sessionId } = Parts.data(result);

    const closeEvt = new Promise(r => bob.once('session-close', r));
    const ack = await alice.invoke(bob.address, 'session-close', [DataPart({ sessionId })]);
    expect(Parts.data(ack)?.ok).toBe(true);

    const evt = await closeEvt;
    expect(evt.sessionId).toBe(sessionId);

    // Session should be gone from StateManager.
    expect(bob.stateManager.getSession(sessionId)).toBeNull();

    await alice.stop(); await bob.stop();
  });

  it('full lifecycle: open → N messages → close', async () => {
    const { alice, bob } = await makePair();

    const messages = [];
    bob.on('session-message', evt => messages.push(evt));

    // Open session.
    const openResult = await alice.invoke(bob.address, 'session-open', [TextPart('start')]);
    const { sessionId } = Parts.data(openResult);

    // Send three messages.
    for (const txt of ['msg-1', 'msg-2', 'msg-3']) {
      await alice.invoke(bob.address, 'session-message', [
        DataPart({ sessionId }), TextPart(txt),
      ]);
    }

    // Close session.
    await alice.invoke(bob.address, 'session-close', [DataPart({ sessionId })]);

    expect(messages).toHaveLength(3);
    expect(bob.stateManager.getSession(sessionId)).toBeNull();

    await alice.stop(); await bob.stop();
  });

  it('two concurrent sessions are independent', async () => {
    const { alice, bob } = await makePair();

    const [r1, r2] = await Promise.all([
      alice.invoke(bob.address, 'session-open', [TextPart('session-A')]),
      alice.invoke(bob.address, 'session-open', [TextPart('session-B')]),
    ]);
    const s1 = Parts.data(r1)?.sessionId;
    const s2 = Parts.data(r2)?.sessionId;
    expect(s1).not.toBe(s2);
    expect(bob.stateManager.getSession(s1)).not.toBeNull();
    expect(bob.stateManager.getSession(s2)).not.toBeNull();

    await alice.invoke(bob.address, 'session-close', [DataPart({ sessionId: s1 })]);
    expect(bob.stateManager.getSession(s1)).toBeNull();
    expect(bob.stateManager.getSession(s2)).not.toBeNull();

    await alice.stop(); await bob.stop();
  });
});

describe('registerSessionSkills', () => {
  it('registers all three session skills on the agent', async () => {
    const bus = new InternalBus();
    const id  = await AgentIdentity.generate(new VaultMemory());
    const t   = new InternalTransport(bus, id.pubKey);
    const a   = new Agent({ identity: id, transport: t });
    registerSessionSkills(a);
    expect(a.skills.has('session-open')).toBe(true);
    expect(a.skills.has('session-message')).toBe(true);
    expect(a.skills.has('session-close')).toBe(true);
  });
});
