/**
 * Agent.agentRegistry — opaque-slot unit tests (Phase 50.8).
 *
 * Standardisation Phase 50.8.1 — verifies the opaque agent-registry
 * slot on `Agent`.  The substrate
 * (`@onderling/agent-registry`, forthcoming) is NOT imported by core;
 * the slot is a property bag the caller (typically the
 * `@onderling/agent-provisioning` facade, Phase 50.5.b) fills.
 *
 * Covers:
 *   - Default value is `null`.
 *   - Constructor arg propagates to the getter.
 *   - The slot is opaque — any object shape works; core does not
 *     enforce a contract.
 *   - Slot is independent of `Agent.webid` (50.2) and
 *     `Agent.pseudoPod` (50.3) — all three can be set
 *     independently.
 *
 * Phase 50.8.2 (Bootstrap injection) lands when Phase 50.5
 * (core.Bootstrap rework) ships.  This test file's scope is
 * limited to the slot mechanics.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '@onderling/vault';
import { Agent }         from '../src/Agent.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';

async function makeAgent(extra = {}) {
  const identity  = await AgentIdentity.generate(new VaultMemory());
  const transport = new InternalTransport(new InternalBus(), identity.pubKey);
  return new Agent({ identity, transport, ...extra });
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent — agentRegistry opaque slot', () => {
  it('is null by default', async () => {
    const agent = await makeAgent();
    expect(agent.agentRegistry).toBe(null);
  });

  it('stores whatever object the caller passes in', async () => {
    const fake = {
      register: async () => ({ ok: true }),
      lookup:   () => ({ pubKey: 'abc', webid: 'https://x' }),
      revoke:   async () => {},
      label:    'fake-registry',
    };
    const agent = await makeAgent({ agentRegistry: fake });
    expect(agent.agentRegistry).toBe(fake);
    expect(agent.agentRegistry.label).toBe('fake-registry');
  });

  it('does not enforce a contract — opaque any-shape value works', async () => {
    // String, array, function all accepted. Same opaque-slot semantics
    // as Agent.webid (50.2) and Agent.pseudoPod (50.3).
    const agent = await makeAgent({ agentRegistry: 'opaque-handle' });
    expect(agent.agentRegistry).toBe('opaque-handle');

    const arr = [1, 2, 3];
    const a2 = await makeAgent({ agentRegistry: arr });
    expect(a2.agentRegistry).toBe(arr);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent — slot independence (webid / pseudoPod / agentRegistry)', () => {
  it('all three slots can be set independently', async () => {
    const webid    = { kind: 'webid-cache' };
    const pseudoP  = { kind: 'pseudo-pod' };
    const registry = { kind: 'agent-registry' };

    const agent = await makeAgent({
      webid,
      pseudoPod: pseudoP,
      agentRegistry: registry,
    });

    expect(agent.webid).toBe(webid);
    expect(agent.pseudoPod).toBe(pseudoP);
    expect(agent.agentRegistry).toBe(registry);
  });

  it('omitting one slot leaves it null without affecting the others', async () => {
    const webid    = { kind: 'webid-cache' };
    const registry = { kind: 'agent-registry' };

    // no pseudoPod supplied
    const agent = await makeAgent({ webid, agentRegistry: registry });

    expect(agent.webid).toBe(webid);
    expect(agent.pseudoPod).toBe(null);
    expect(agent.agentRegistry).toBe(registry);
  });

  it('omitting all three leaves them all null', async () => {
    const agent = await makeAgent();
    expect(agent.webid).toBe(null);
    expect(agent.pseudoPod).toBe(null);
    expect(agent.agentRegistry).toBe(null);
  });
});
