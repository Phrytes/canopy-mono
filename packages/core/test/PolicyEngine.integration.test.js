/**
 * PolicyEngine + Agent integration tests.
 *
 * Verifies that the PolicyEngine blocks or permits calls end-to-end
 * when configured on an Agent — not just the unit-level policy checks.
 */
import { describe, it, expect } from 'vitest';
import { Agent }          from '../src/Agent.js';
import { AgentIdentity }  from '../src/identity/AgentIdentity.js';
import { VaultMemory }    from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, Parts } from '../src/Parts.js';
import { TrustRegistry }  from '../src/permissions/TrustRegistry.js';
import { PolicyEngine }   from '../src/permissions/PolicyEngine.js';
import { CapabilityToken } from '../src/permissions/CapabilityToken.js';
import { TokenRegistry }  from '../src/permissions/TokenRegistry.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

async function makePair() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);
  const tr  = new TrustRegistry(new VaultMemory());

  const alice = new Agent({ identity: idA, transport: tA });
  const bob   = new Agent({ identity: idB, transport: tB, trustRegistry: tr });

  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();
  return { alice, bob, idA, idB, tr };
}

/**
 * Install a PolicyEngine on bob AFTER skills have been registered, so that
 * the PE's skillRegistry references the already-populated registry.
 */
function installPE(bob, tr) {
  const pe = new PolicyEngine({
    trustRegistry: tr,
    skillRegistry: bob.skills,
    agentPubKey:   bob.pubKey,
  });
  Object.defineProperty(bob, 'policyEngine', { get: () => pe, configurable: true });
  return pe;
}

// ── Visibility gate ───────────────────────────────────────────────────────────

describe('visibility gate', () => {
  it('public skill is callable by tier-0 caller', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('greet', async () => [TextPart('hello')], { visibility: 'public' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'public');

    const result = await alice.invoke(bob.address, 'greet', []);
    expect(Parts.text(result)).toBe('hello');

    await alice.stop(); await bob.stop();
  });

  it('authenticated skill is blocked for tier-0 caller', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('secret', async () => [TextPart('secret data')], { visibility: 'authenticated' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'public');

    const task = alice.call(bob.address, 'secret', []);
    await expect(task.done()).rejects.toThrow();
    expect(task.state).toBe('failed');

    await alice.stop(); await bob.stop();
  });

  it('authenticated skill is callable by tier-1 caller', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('secret', async () => [TextPart('secret data')], { visibility: 'authenticated' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');

    const result = await alice.invoke(bob.address, 'secret', []);
    expect(Parts.text(result)).toBe('secret data');

    await alice.stop(); await bob.stop();
  });

  it('private skill is blocked even for tier-3 caller', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('admin', async () => [TextPart('admin')], { visibility: 'private', policy: 'never' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'private');

    const task = alice.call(bob.address, 'admin', []);
    await expect(task.done()).rejects.toThrow();

    await alice.stop(); await bob.stop();
  });
});

// ── Policy gate ───────────────────────────────────────────────────────────────

describe('policy gate', () => {
  it('on-request skill is callable when caller is tier >= 1', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('data', async () => [TextPart('data')],
      { visibility: 'authenticated', policy: 'on-request' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');

    const result = await alice.invoke(bob.address, 'data', []);
    expect(Parts.text(result)).toBe('data');

    await alice.stop(); await bob.stop();
  });
});

// ── Capability token gate ─────────────────────────────────────────────────────

describe('capability token gate', () => {
  it('issued token has correct fields and verifies', async () => {
    const { alice, bob, idB } = await makePair();

    const token = await CapabilityToken.issue(idB, {
      subject:   alice.pubKey,
      skill:     'vip',
      agentId:   bob.pubKey,
      expiresIn: 60_000,
    });

    expect(CapabilityToken.verify(token, bob.pubKey)).toBe(true);
    expect(token.subject).toBe(alice.pubKey);
    expect(token.skill).toBe('vip');
    expect(token.isExpired).toBe(false);

    await alice.stop(); await bob.stop();
  });

  it('expired capability token fails verify', async () => {
    const { alice, idB } = await makePair();

    const token = await CapabilityToken.issue(idB, {
      subject:   alice.pubKey,
      skill:     'any',
      agentId:   idB.pubKey,
      expiresIn: -1_000,   // already expired
    });

    expect(CapabilityToken.verify(token, idB.pubKey)).toBe(false);

    await alice.stop();
  });

  it('caller with valid token in TokenRegistry can access a skill', async () => {
    const { alice, bob, idB, tr } = await makePair();
    bob.register('vip', async () => [TextPart('vip-content')],
      { visibility: 'authenticated', policy: 'on-request' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');

    const token = await CapabilityToken.issue(idB, {
      subject:   alice.pubKey,
      skill:     'vip',
      agentId:   bob.pubKey,
      expiresIn: 60_000,
    });
    const tokenReg = new TokenRegistry(new VaultMemory());
    await tokenReg.store(token);
    expect(await tokenReg.get(bob.pubKey, 'vip')).not.toBeNull();

    const result = await alice.invoke(bob.address, 'vip', []);
    expect(Parts.text(result)).toBe('vip-content');

    await alice.stop(); await bob.stop();
  });
});

// ── Unknown skill ─────────────────────────────────────────────────────────────

describe('unknown skill', () => {
  it('calling a non-existent skill fails', async () => {
    const { alice, bob } = await makePair();

    const task = alice.call(bob.address, 'does-not-exist', []);
    await expect(task.done()).rejects.toThrow();
    expect(task.state).toBe('failed');

    await alice.stop(); await bob.stop();
  });
});

// ── Dynamic trust tier changes ────────────────────────────────────────────────

describe('dynamic trust tier changes', () => {
  it('dropping a caller to tier-0 blocks subsequent calls', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('data', async () => [TextPart('ok')], { visibility: 'authenticated' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');

    const r1 = await alice.invoke(bob.address, 'data', []);
    expect(Parts.text(r1)).toBe('ok');

    await tr.setTier(alice.pubKey, 'public');

    const task2 = alice.call(bob.address, 'data', []);
    await expect(task2.done()).rejects.toThrow();

    await alice.stop(); await bob.stop();
  });
});
