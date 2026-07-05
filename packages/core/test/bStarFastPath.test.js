/**
 * B★ in-process fast-path — fitness functions.
 *
 * These lock in the "one uniform invocation route" first slice: a same-bus,
 * same-process call runs the RECEIVER-side gate (runGatedSkill) directly on the
 * target agent, skipping envelope build / encrypt / decrypt / bus hop, WITHOUT
 * changing gate semantics or error strings.
 *
 *   1. no-double-serialize — a same-bus invoke does NOT serialize/encrypt
 *      (no t.request / t._put / SecurityLayer.encrypt) yet DOES run the gate
 *      (policyEngine.checkInbound).
 *   2. gate-parity — the SAME op through the wire path (handleTaskRequest) and
 *      the fast-path (alice.invoke, same bus) yields identical results and
 *      identical denial errors (unknown / disabled / non-member), including the
 *      "don't reveal existence" Unknown-skill reply.
 */
import { describe, it, expect, vi }         from 'vitest';
import { Agent }                            from '../src/Agent.js';
import { AgentIdentity }                    from '../src/identity/AgentIdentity.js';
import { VaultMemory }                      from '@canopy/vault';
import { SecurityLayer }                    from '../src/security/SecurityLayer.js';
import { InternalBus, InternalTransport }   from '../src/transport/InternalTransport.js';
import { TextPart, Parts }                  from '../src/Parts.js';
import { handleTaskRequest }                from '../src/protocol/taskExchange.js';

async function makePair(bobOpts = {}) {
  const bus     = new InternalBus();
  const aliceId = await AgentIdentity.generate(new VaultMemory());
  const bobId   = await AgentIdentity.generate(new VaultMemory());
  const alice   = new Agent({ identity: aliceId, transport: new InternalTransport(bus, aliceId.pubKey, { identity: aliceId }) });
  const bob     = new Agent({ identity: bobId,   transport: new InternalTransport(bus, bobId.pubKey,   { identity: bobId }), ...bobOpts });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start();
  await bob.start();
  return { alice, bob };
}

// ── 1. no-double-serialize ──────────────────────────────────────────────────

describe('B★ fast-path — no-double-serialize', () => {
  it('same-bus invoke runs the gate but skips serialize/encrypt/bus-hop', async () => {
    const { alice, bob } = await makePair();
    bob.register('greet', async ({ parts }) => [TextPart(`hi ${Parts.text(parts) ?? ''}`)], { visibility: 'public' });

    // The receiver-side policy gate MUST still run (on bob).
    const checkInbound = vi.fn(async () => {});
    Object.defineProperty(bob, 'policyEngine', { get: () => ({ checkInbound }), configurable: true });

    // Serialization/crypto/wire primitives MUST NOT run for a same-bus call.
    // (mkEnvelope is a module fn Transport calls internally — spying on
    // request/_put, its only task-path callers, proves it isn't invoked.)
    const encryptSpy = vi.spyOn(alice.transport.securityLayer, 'encrypt');
    const requestSpy = vi.spyOn(alice.transport, 'request');
    const putSpy     = vi.spyOn(alice.transport, '_put');

    const result = await alice.invoke(bob.address, 'greet', [TextPart('bob')]);
    expect(Parts.text(result)).toBe('hi bob');

    expect(checkInbound).toHaveBeenCalledTimes(1);         // gate ran
    expect(encryptSpy).not.toHaveBeenCalled();             // no encrypt
    expect(requestSpy).not.toHaveBeenCalled();             // no RQ envelope
    expect(putSpy).not.toHaveBeenCalled();                 // no bus hop

    await alice.stop(); await bob.stop();
  });
});

// ── 2. gate-parity ──────────────────────────────────────────────────────────

/**
 * Drive the WIRE path (handleTaskRequest) directly with a stub transport that
 * captures the task-result payload bob responds with.
 */
function wireOutcome(bob, fromAddr, skillId, parts = []) {
  return new Promise((resolve) => {
    const fakeT = {
      respond:    async (_to, _re, payload) => resolve(payload),
      sendOneWay: async () => {},
    };
    const env = {
      _from: fromAddr, _id: 'wire-1', _transport: fakeT,
      payload: { type: 'task', taskId: 'wire-t', skillId, parts },
    };
    handleTaskRequest(bob, env);
  });
}

/** Drive the FAST path (same-bus invoke) and normalise to the same shape. */
async function fastOutcome(alice, bob, skillId, parts = []) {
  try {
    const rParts = await alice.invoke(bob.address, skillId, parts);
    return { status: 'completed', parts: rParts };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}

describe('B★ fast-path — gate-parity (wire ≡ fast)', () => {
  it('successful op: identical completed result', async () => {
    const { alice, bob } = await makePair();
    bob.register('echo', async ({ parts }) => [TextPart(Parts.text(parts) ?? '')], { visibility: 'public' });

    const wire = await wireOutcome(bob, alice.address, 'echo', [TextPart('x')]);
    const fast = await fastOutcome(alice, bob, 'echo', [TextPart('x')]);

    expect(wire.status).toBe('completed');
    expect(fast.status).toBe('completed');
    expect(Parts.text(wire.parts)).toBe('x');
    expect(Parts.text(fast.parts)).toBe('x');

    await alice.stop(); await bob.stop();
  });

  it('unknown skill: identical "Unknown skill" reply (don\'t reveal existence)', async () => {
    const { alice, bob } = await makePair();

    const wire = await wireOutcome(bob, alice.address, 'nope');
    const fast = await fastOutcome(alice, bob, 'nope');

    expect(wire.status).toBe('failed');
    expect(fast.status).toBe('failed');
    expect(wire.error).toBe('Unknown skill: "nope"');
    expect(fast.error).toBe(wire.error);

    await alice.stop(); await bob.stop();
  });

  it('disabled skill: identical disabled reply', async () => {
    const { alice, bob } = await makePair();
    bob.register('off', async () => [TextPart('never')], { visibility: 'public', enabled: false });

    const wire = await wireOutcome(bob, alice.address, 'off');
    const fast = await fastOutcome(alice, bob, 'off');

    expect(wire.error).toBe('Skill "off" is disabled');
    expect(fast.error).toBe(wire.error);

    await alice.stop(); await bob.stop();
  });

  it('non-member of a group-restricted skill: identical "Unknown skill" reply', async () => {
    // Bob hosts a group-visible skill; alice holds no proof → non-member.
    const bobVault = new VaultMemory();
    const bobIdent = await AgentIdentity.generate(bobVault);
    const { GroupManager } = await import('../src/permissions/GroupManager.js');
    const bobGm  = new GroupManager({ identity: bobIdent, vault: bobVault });
    const bobSec = new SecurityLayer({ identity: bobIdent });
    bobSec.groupManager = bobGm;

    const bus     = new InternalBus();
    const aliceId = await AgentIdentity.generate(new VaultMemory());
    const alice   = new Agent({ identity: aliceId, transport: new InternalTransport(bus, aliceId.pubKey, { identity: aliceId }) });
    const bob     = new Agent({ identity: bobIdent, transport: new InternalTransport(bus, bobIdent.pubKey, { identity: bobIdent }), security: bobSec });
    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);
    await alice.start(); await bob.start();

    bob.register('ops-only', async () => [TextPart('secret')], { visibility: { groups: ['ops'], default: 'hidden' } });

    const wire = await wireOutcome(bob, alice.address, 'ops-only');
    const fast = await fastOutcome(alice, bob, 'ops-only');

    expect(wire.error).toBe('Unknown skill: "ops-only"');   // masks existence
    expect(fast.error).toBe(wire.error);

    await alice.stop(); await bob.stop();
  });
});
