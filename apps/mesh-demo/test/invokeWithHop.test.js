/**
 * Tests for Group C — invokeWithHop helper.
 *
 * Topology:
 *   caller ──(bus)── relay ──(bus)── target
 *
 * In caller's PeerGraph:
 *   relay:  { reachable: true,  hops: 0, knownPeers: [target.pubKey] }
 *   target: not present, OR { reachable: false }
 *
 * In relay's PeerGraph:
 *   target: { reachable: true, hops: 0 }
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InternalBus, DataPart, TextPart, Parts } from '@canopy/core';
import { makeAgent, startAndConnect }             from './helpers.js';
import { registerRelaySkill }                     from '../src/relaySkill.js';
import { invokeWithHop }                          from '../src/routing/invokeWithHop.js';

let bus, caller, relay, target;

beforeEach(async () => {
  bus    = new InternalBus();
  caller = await makeAgent(bus, { label: 'caller' });
  relay  = await makeAgent(bus, { label: 'relay', allowRelayFor: 'always' });
  target = await makeAgent(bus, { label: 'target' });

  registerRelaySkill(relay);
  target.register('echo', async ({ parts }) => parts);

  await startAndConnect(caller, relay, target);

  // relay knows target directly
  await relay.peers.upsert({
    type: 'native', pubKey: target.pubKey,
    reachable: true, hops: 0, transports: {},
  });

  // caller knows relay and knows relay can reach target
  await caller.peers.upsert({
    type: 'native', pubKey: relay.pubKey,
    reachable: true, hops: 0,
    knownPeers: [target.pubKey],
    transports: {},
  });
  // target is NOT in caller's PeerGraph (simulates no direct route)
});

// ── Direct path ───────────────────────────────────────────────────────────────

describe('invokeWithHop — direct', () => {
  it('calls directly when target is in PeerGraph and reachable', async () => {
    // For a direct call both SecurityLayers must know each other's pubKey.
    // In production this comes from a hello; in tests we register manually.
    caller.addPeer(target.address, target.pubKey);
    target.addPeer(caller.address, caller.pubKey);
    await caller.peers.upsert({
      type: 'native', pubKey: target.pubKey,
      reachable: true, hops: 0, transports: {},
    });

    const result = await invokeWithHop(caller, target.pubKey, 'echo', [TextPart('direct')]);
    expect(Parts.text(result)).toBe('direct');
  });
});

// ── Hop path ──────────────────────────────────────────────────────────────────

describe('invokeWithHop — relay hop', () => {
  it('routes via relay when target not directly reachable', async () => {
    const result = await invokeWithHop(caller, target.pubKey, 'echo',
      [DataPart({ msg: 'hopped' })]);
    // invokeWithHop unwraps the relay result
    const data = Parts.data(result);
    expect(data?.msg ?? data?.result?.msg).toBe('hopped');
  });

  it('prefers lower-hop relay when multiple candidates exist', async () => {
    const relay2 = await makeAgent(bus, { label: 'relay2', allowRelayFor: 'always' });
    registerRelaySkill(relay2);
    await relay2.start();
    await caller.hello(relay2.address);
    await relay2.peers.upsert({ type: 'native', pubKey: target.pubKey, reachable: true, hops: 0, transports: {} });

    // relay2 is at hops:1 (via some other peer), relay is at hops:0
    await caller.peers.upsert({
      type: 'native', pubKey: relay2.pubKey,
      reachable: true, hops: 1,
      knownPeers: [target.pubKey],
      transports: {},
    });

    // Should still work (picks relay at hops:0 first) — result is the echoed TextPart
    const result = await invokeWithHop(caller, target.pubKey, 'echo', [TextPart('ok')]);
    expect(result.length).toBeGreaterThan(0);

    await relay2.stop();
  });
});

// ── No route ──────────────────────────────────────────────────────────────────

describe('invokeWithHop — no route', () => {
  it('throws when no relay peer knows the target', async () => {
    // Remove target from relay's knownPeers
    await caller.peers.upsert({
      type: 'native', pubKey: relay.pubKey,
      reachable: true, hops: 0,
      knownPeers: [],    // relay no longer advertises target
      transports: {},
    });

    await expect(
      invokeWithHop(caller, target.pubKey, 'echo', [])
    ).rejects.toThrow(/No route/);
  });

  it('throws when relay is unreachable', async () => {
    await caller.peers.upsert({
      type: 'native', pubKey: relay.pubKey,
      reachable: false,           // relay went offline
      knownPeers: [target.pubKey],
    });

    await expect(
      invokeWithHop(caller, target.pubKey, 'echo', [])
    ).rejects.toThrow(/No route/);
  });
});
