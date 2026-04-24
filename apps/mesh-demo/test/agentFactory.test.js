/**
 * agent.js — smoke test for the rewritten (Group U) factory.
 *
 * Asserts the app's createAgent() actually drives the SDK helpers and
 * registers its 'receive-message' skill. createMeshAgent itself is
 * already covered in packages/react-native/test/createMeshAgent.test.js;
 * here we just prove that the app wires things up correctly on top.
 *
 * See EXTRACTION-PLAN.md §7 Group U and CODING-PLAN.md Group U.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the SDK factory so we don't need the native stack here.
vi.mock('@canopy/react-native', () => {
  class FakeAgent {
    constructor() {
      this._enableRelayForwardOpts     = null;
      this._enableAutoHelloOpts        = null;
      this._startDiscoveryOpts         = null;
      this._oracleEnabled              = false;
      this._sealedForwardGroups        = [];
      this._tunnelEnabled              = false;
      this._started                     = false;
      this._skills                      = new Map();
    }
    enableRelayForward(opts) {
      this._enableRelayForwardOpts = opts;
      return this;
    }
    enableAutoHello(opts) {
      this._enableAutoHelloOpts = opts;
      return this;
    }
    startDiscovery(opts) {
      this._startDiscoveryOpts = opts;
      return { stop: async () => {} };
    }
    enableReachabilityOracle(opts) {
      this._oracleEnabled     = true;
      this._oracleOpts        = opts ?? {};
      return this;
    }
    enableSealedForwardFor(groupId, opts) {
      this._sealedForwardGroups.push({ groupId, opts: opts ?? {} });
      return this;
    }
    enableTunnelForward(opts) {
      this._tunnelEnabled     = true;
      this._tunnelOpts        = opts ?? {};
      return this;
    }
    async start() { this._started = true; }
    register(id, handler, meta) {
      this._skills.set(id, { handler, meta });
      return this;
    }
    // `registerCapabilitiesSkill` + `registerTunnelReceiveSealed` inspect
    // agent.skills via `skills?.get?.(id)`.
    get skills() { return this._skills; }
  }

  return {
    createMeshAgent: vi.fn(async (opts) => {
      const a      = new FakeAgent();
      a._factoryOpts = opts;
      return a;
    }),
    KeychainVault: class { constructor(o) { this.opts = o; } },
  };
});

import { createAgent }                    from '../src/agent.js';
import { createMeshAgent }                from '@canopy/react-native';
import { TextPart, Parts }                 from '@canopy/core';

describe('mesh-demo createAgent factory', () => {

  it('delegates to createMeshAgent with the mesh-demo label + prefix', async () => {
    const agent = await createAgent({ relayUrl: 'ws://1.2.3.4:9999' });

    expect(createMeshAgent).toHaveBeenCalledOnce();
    const opts = createMeshAgent.mock.calls[0][0];
    expect(opts.label).toBe('mesh-phone');
    expect(opts.relayUrl).toBe('ws://1.2.3.4:9999');
    expect(opts.peerGraphPrefix).toBe('mesh-demo:peers:');
    expect(opts.vault).toBeTruthy();   // a KeychainVault instance
  });

  it('enables relay-forward with the authenticated policy', async () => {
    const agent = await createAgent({});
    expect(agent._enableRelayForwardOpts).toEqual({ policy: 'authenticated' });
  });

  it('enables auto-hello with pullPeers true', async () => {
    const agent = await createAgent({});
    expect(agent._enableAutoHelloOpts).toEqual({ pullPeers: true });
  });

  it('starts discovery with a 15-second gossip interval', async () => {
    const agent = await createAgent({});
    expect(agent._startDiscoveryOpts).toEqual({ gossipIntervalMs: 15_000 });
  });

  it('enables the reachability oracle', async () => {
    const agent = await createAgent({});
    expect(agent._oracleEnabled).toBe(true);
  });

  it('registers the get-capabilities skill', async () => {
    const agent = await createAgent({});
    expect(agent._skills.has('get-capabilities')).toBe(true);
  });

  it('enables sealed-forward for the "mesh" group', async () => {
    const agent = await createAgent({});
    expect(agent._sealedForwardGroups).toEqual([
      { groupId: 'mesh', opts: {} },
    ]);
  });

  it('registers the receive-message skill with public visibility', async () => {
    const agent = await createAgent({});
    const skill = agent._skills.get('receive-message');
    expect(skill).toBeTruthy();
    expect(skill.meta.visibility).toBe('public');
  });

  it("receive-message attributes to originFrom when it's set", async () => {
    // Import here so the mock is active for the agent.js module import above
    const { messageStore } = await import('../src/store/messages.js');
    messageStore.reset?.();

    const agent   = await createAgent({});
    const handler = agent._skills.get('receive-message').handler;
    await handler({
      parts:      [TextPart('hello')],
      from:       'RELAY_HOP_PUBKEY',
      originFrom: 'ALICE_PUBKEY',
    });

    const msgs = messageStore.get('ALICE_PUBKEY');
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe('hello');
    expect(msgs[0].direction).toBe('in');
  });

  it('receive-message falls back to `from` when originFrom is missing', async () => {
    const { messageStore } = await import('../src/store/messages.js');
    messageStore.reset?.();

    const agent   = await createAgent({});
    const handler = agent._skills.get('receive-message').handler;
    await handler({ parts: [TextPart('direct')], from: 'BOB_PUBKEY' });

    const msgs = messageStore.get('BOB_PUBKEY');
    expect(msgs.at(-1).text).toBe('direct');
  });

  it('receive-message records originVerified + relayedBy on forwarded hops', async () => {
    const { messageStore } = await import('../src/store/messages.js');
    messageStore.reset?.();

    const agent   = await createAgent({});
    const handler = agent._skills.get('receive-message').handler;
    await handler({
      parts:          [TextPart('signed via bridge')],
      from:           'BRIDGE_PUBKEY',
      originFrom:     'ALICE_PUBKEY',
      originVerified: true,
    });

    const entry = messageStore.get('ALICE_PUBKEY').at(-1);
    expect(entry.text).toBe('signed via bridge');
    expect(entry.originVerified).toBe(true);
    expect(entry.relayedBy).toBe('BRIDGE_PUBKEY');
  });

  it('receive-message leaves originVerified=false when the ctx flag is absent', async () => {
    const { messageStore } = await import('../src/store/messages.js');
    messageStore.reset?.();

    const agent   = await createAgent({});
    const handler = agent._skills.get('receive-message').handler;
    await handler({ parts: [TextPart('unsigned')], from: 'BOB_PUBKEY' });

    const entry = messageStore.get('BOB_PUBKEY').at(-1);
    expect(entry.originVerified).toBe(false);
    expect(entry.relayedBy).toBeNull();
  });
});
