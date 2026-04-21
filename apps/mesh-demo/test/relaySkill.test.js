/**
 * Tests for Group C — relay-forward skill.
 *
 * Three-node topology:
 *   caller ──(bus)── relay ──(bus)── target
 *
 * caller has no PeerGraph entry for target (simulates no direct route).
 * relay has target in its PeerGraph and the relay-forward skill registered.
 * target has an 'echo' skill.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InternalBus, DataPart, Parts, TextPart } from '@canopy/core';
import { makeAgent, startAndConnect }             from './helpers.js';
import { registerRelaySkill }                     from '../src/relaySkill.js';

// ── Shared setup ──────────────────────────────────────────────────────────────

let bus, caller, relay, target;

beforeEach(async () => {
  bus = new InternalBus();

  caller = await makeAgent(bus, { label: 'caller', allowRelayFor: 'never' });
  relay  = await makeAgent(bus, { label: 'relay',  allowRelayFor: 'always' });
  target = await makeAgent(bus, { label: 'target' });

  // Register skills
  registerRelaySkill(relay);
  target.register('echo', async ({ parts }) => parts);

  // Start and wire: caller ↔ relay ↔ target
  await startAndConnect(caller, relay, target);

  // Give relay a direct PeerGraph entry for target (hops:0)
  await relay.peers.upsert({
    type: 'native', pubKey: target.pubKey,
    reachable: true, hops: 0, transports: {},
  });
});

// ── Policy tests ──────────────────────────────────────────────────────────────

describe('relay-forward policy', () => {
  it('returns error when allowRelayFor is "never"', async () => {
    // Use caller as the relay agent (it has allowRelayFor: 'never')
    registerRelaySkill(caller);
    const result = await caller.invoke(caller.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'echo',
    })]);
    expect(Parts.data(result)?.error).toBe('relay-not-enabled');
  });

  it('allows forwarding when allowRelayFor is "always"', async () => {
    const result = await caller.invoke(relay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'echo',
      payload: [TextPart('hello')],
    })]);
    const data = Parts.data(result);
    expect(data?.forwarded).toBe(true);
  });

  it('returns error when allowRelayFor is "trusted" and caller is only tier 1 (authenticated — not elevated to trusted)', async () => {
    // Create a separate relay agent with 'trusted' policy and a TrustRegistry
    const trustedRelay = await makeAgent(bus, {
      label:             'trusted-relay',
      allowRelayFor:     'trusted',
      withTrustRegistry: true,
    });
    registerRelaySkill(trustedRelay);
    await trustedRelay.peers.upsert({
      type: 'native', pubKey: target.pubKey,
      reachable: true, hops: 0, transports: {},
    });
    await trustedRelay.start();
    await caller.hello(trustedRelay.address);

    // caller is at tier 0 (never explicitly trusted)
    const result = await caller.invoke(trustedRelay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'echo',
    })]);
    expect(Parts.data(result)?.error).toMatch('trust tier');

    await trustedRelay.stop();
  });

  it('allows forwarding when allowRelayFor is "trusted" and caller is tier 2 (explicitly elevated to "trusted")', async () => {
    const trustedRelay = await makeAgent(bus, {
      label:             'trusted-relay',
      allowRelayFor:     'trusted',
      withTrustRegistry: true,
    });
    registerRelaySkill(trustedRelay);
    await trustedRelay.peers.upsert({
      type: 'native', pubKey: target.pubKey,
      reachable: true, hops: 0, transports: {},
    });
    await trustedRelay.start();
    await caller.hello(trustedRelay.address);

    // Elevate caller to tier 2 ('trusted') — the threshold for allowRelayFor:'trusted'
    await trustedRelay.trustRegistry.setTier(caller.pubKey, 'trusted');
    // Both sides need mutual pubKey registration for the forward to reach target
    trustedRelay.addPeer(target.address, target.pubKey);
    target.addPeer(trustedRelay.address, trustedRelay.pubKey);

    const result = await caller.invoke(trustedRelay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'echo',
      payload: [TextPart('ping')],
    })]);
    expect(Parts.data(result)?.forwarded).toBe(true);

    await trustedRelay.stop();
  });

  it('returns error when policy is "trusted" but no trustRegistry is wired', async () => {
    // Agent has allowRelayFor:'trusted' but no trustRegistry → defaults to 'public' tier → denied
    const noRegistryRelay = await makeAgent(bus, {
      label:             'no-registry-relay',
      allowRelayFor:     'trusted',
      withTrustRegistry: false,   // no TrustRegistry
    });
    registerRelaySkill(noRegistryRelay);
    await noRegistryRelay.peers.upsert({
      type: 'native', pubKey: target.pubKey,
      reachable: true, hops: 0, transports: {},
    });
    await noRegistryRelay.start();
    await caller.hello(noRegistryRelay.address);

    const result = await caller.invoke(noRegistryRelay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'echo',
    })]);
    expect(Parts.data(result)?.error).toMatch('trust tier');

    await noRegistryRelay.stop();
  });

  it('returns error for "group:X" policy when caller has no group proof', async () => {
    const groupRelay = await makeAgent(bus, {
      label:         'group-relay',
      allowRelayFor: 'group:mesh-members',
    });
    registerRelaySkill(groupRelay);
    await groupRelay.peers.upsert({
      type: 'native', pubKey: target.pubKey,
      reachable: true, hops: 0, transports: {},
    });
    await groupRelay.start();
    await caller.hello(groupRelay.address);

    const result = await caller.invoke(groupRelay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'echo',
    })]);
    // No group proof → relay-denied
    expect(Parts.data(result)?.error).toMatch('relay-denied');

    await groupRelay.stop();
  });
}); // end describe('relay-forward policy')

// ── Input validation tests ─────────────────────────────────────────────────────

describe('relay-forward validation', () => {
  it('returns error when targetPubKey is missing', async () => {
    const result = await caller.invoke(relay.address, 'relay-forward', [DataPart({
      skill: 'echo',
    })]);
    expect(Parts.data(result)?.error).toBe('missing targetPubKey');
  });

  it('returns error when skill is missing', async () => {
    const result = await caller.invoke(relay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
    })]);
    expect(Parts.data(result)?.error).toBe('missing skill');
  });

  it('returns error when target is not reachable from relay', async () => {
    await relay.peers.upsert({
      type: 'native', pubKey: target.pubKey,
      reachable: false,    // mark unreachable
    });
    const result = await caller.invoke(relay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'echo',
    })]);
    expect(Parts.data(result)?.error).toBe('target-unreachable');
  });

  it('refuses to relay to the caller itself (loop guard) — relay-loop fires even when target is not in graph', async () => {
    // Loop guard runs before reachability check, so relay-loop is returned
    // even when caller is absent from relay's PeerGraph.
    const result = await caller.invoke(relay.address, 'relay-forward', [DataPart({
      targetPubKey: caller.pubKey,
      skill: 'echo',
    })]);
    expect(Parts.data(result)?.error).toMatch('relay-loop');
  });

  it('refuses to relay to the caller itself (loop guard) — explicit loop error when target is in graph', async () => {
    // Put caller into relay's PeerGraph so the loop guard fires
    await relay.peers.upsert({
      type: 'native', pubKey: caller.pubKey,
      reachable: true, hops: 0, transports: {},
    });
    const result = await caller.invoke(relay.address, 'relay-forward', [DataPart({
      targetPubKey: caller.pubKey,
      skill: 'echo',
    })]);
    expect(Parts.data(result)?.error).toMatch('relay-loop');
  });
});

// ── End-to-end forwarding ──────────────────────────────────────────────────────

describe('relay-forward forwarding', () => {
  it('forwards the payload and returns the echoed result', async () => {
    const result = await caller.invoke(relay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'echo',
      payload: [DataPart({ value: 42 })],
    })]);
    const data = Parts.data(result);
    expect(data?.forwarded).toBe(true);
    // relay-forward encodes the target's result as data.parts
    expect(Parts.data(data?.parts)?.value).toBe(42);
  });

  it('wraps a forward-failed error when the target skill throws', async () => {
    target.register('broken', async () => { throw new Error('skill exploded'); });
    // Need to let target know relay (hello chain: caller↔relay↔target already done)
    const result = await caller.invoke(relay.address, 'relay-forward', [DataPart({
      targetPubKey: target.pubKey,
      skill: 'broken',
    })]);
    const data = Parts.data(result);
    expect(data?.error).toMatch('forward-failed');
  });
});
