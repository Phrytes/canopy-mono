/**
 * Agent.interfaceRegistry + Agent.protocol — opaque-slot unit tests
 * (direction).
 *
 * Direction-only: the substrates `@onderling/interface-registry` and
 * `@onderling/protocol` don't exist yet. Core ships the slots so the
 * substrate APIs have a stable plug-in point when they materialise
 * (Hub V2 of the standardisation plan).
 *
 * The slots mirror the pattern from Phase 50.8.1
 * (`Agent.agentRegistry`) and Phase 50.3 (`Agent.pseudoPod`):
 *   - Default value is `null`.
 *   - Constructor arg propagates to the getter.
 *   - Opaque — any object shape works; core enforces no contract.
 *   - Independent of every other slot.
 *   - Participates in `bindToHub` / `unbindFromHub` fan-out.
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

function makeSlotWithSetHost(name) {
  const calls = [];
  return {
    name,
    setHost(kind, binder) { calls.push({ kind, binder }); },
    get calls() { return calls; },
  };
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent — interfaceRegistry opaque slot (Phase 50.13)', () => {
  it('is null by default', async () => {
    const agent = await makeAgent();
    expect(agent.interfaceRegistry).toBe(null);
  });

  it('stores whatever object the caller passes in', async () => {
    const fake = {
      register: async () => {},
      lookup: () => null,
      renderCompact: () => null,
      renderFull: () => null,
      label: 'fake-interface-registry',
    };
    const agent = await makeAgent({ interfaceRegistry: fake });
    expect(agent.interfaceRegistry).toBe(fake);
    expect(agent.interfaceRegistry.label).toBe('fake-interface-registry');
  });

  it('accepts any opaque shape — core enforces no contract', async () => {
    const a1 = await makeAgent({ interfaceRegistry: 'string-handle' });
    expect(a1.interfaceRegistry).toBe('string-handle');
    const a2 = await makeAgent({ interfaceRegistry: [1, 2, 3] });
    expect(a2.interfaceRegistry).toEqual([1, 2, 3]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent — protocol opaque slot (Phase 50.14)', () => {
  it('is null by default', async () => {
    const agent = await makeAgent();
    expect(agent.protocol).toBe(null);
  });

  it('stores whatever object the caller passes in', async () => {
    const fake = {
      start: async () => {},
      step: async () => {},
      subscribe: () => () => {},
      label: 'fake-protocol-substrate',
    };
    const agent = await makeAgent({ protocol: fake });
    expect(agent.protocol).toBe(fake);
    expect(agent.protocol.label).toBe('fake-protocol-substrate');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent — all five opaque slots are independent', () => {
  it('all slots can be set independently', async () => {
    const webid             = { kind: 'webid-cache' };
    const pseudoPod         = { kind: 'pseudo-pod' };
    const agentRegistry     = { kind: 'agent-registry' };
    const interfaceRegistry = { kind: 'interface-registry' };
    const protocol          = { kind: 'protocol' };

    const agent = await makeAgent({
      webid, pseudoPod, agentRegistry, interfaceRegistry, protocol,
    });

    expect(agent.webid).toBe(webid);
    expect(agent.pseudoPod).toBe(pseudoPod);
    expect(agent.agentRegistry).toBe(agentRegistry);
    expect(agent.interfaceRegistry).toBe(interfaceRegistry);
    expect(agent.protocol).toBe(protocol);
  });

  it('omitting some leaves them null without affecting others', async () => {
    const interfaceRegistry = { kind: 'ir' };

    const agent = await makeAgent({ interfaceRegistry });

    expect(agent.webid).toBe(null);
    expect(agent.pseudoPod).toBe(null);
    expect(agent.agentRegistry).toBe(null);
    expect(agent.interfaceRegistry).toBe(interfaceRegistry);
    expect(agent.protocol).toBe(null);
  });

  it('omitting all five leaves them all null', async () => {
    const agent = await makeAgent();
    expect(agent.webid).toBe(null);
    expect(agent.pseudoPod).toBe(null);
    expect(agent.agentRegistry).toBe(null);
    expect(agent.interfaceRegistry).toBe(null);
    expect(agent.protocol).toBe(null);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent.bindToHub — fans out to interfaceRegistry + protocol', () => {
  it('notifies interfaceRegistry + protocol when they have setHost', async () => {
    const interfaceRegistry = makeSlotWithSetHost('ir');
    const protocol          = makeSlotWithSetHost('p');

    const agent = await makeAgent({ interfaceRegistry, protocol });
    const binder = { id: 'fake-binder' };

    const result = agent.bindToHub(binder);

    expect(interfaceRegistry.calls).toEqual([{ kind: 'hub', binder }]);
    expect(protocol.calls).toEqual([{ kind: 'hub', binder }]);
    expect(result.notified).toEqual(expect.arrayContaining(['interfaceRegistry', 'protocol']));
  });

  it('notifies all five slots in one call when each has setHost', async () => {
    const slots = {
      webid:             makeSlotWithSetHost('w'),
      pseudoPod:         makeSlotWithSetHost('pp'),
      agentRegistry:     makeSlotWithSetHost('ar'),
      interfaceRegistry: makeSlotWithSetHost('ir'),
      protocol:          makeSlotWithSetHost('p'),
    };
    const agent  = await makeAgent(slots);
    const binder = { id: 'b' };

    const result = agent.bindToHub(binder);

    expect(result.notified.sort()).toEqual([
      'agentRegistry', 'interfaceRegistry', 'protocol', 'pseudoPod', 'webid',
    ].sort());
    for (const slot of Object.values(slots)) {
      expect(slot.calls).toEqual([{ kind: 'hub', binder }]);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent.unbindFromHub — fans out to interfaceRegistry + protocol', () => {
  it('calls setHost(null) on interfaceRegistry + protocol', async () => {
    const interfaceRegistry = makeSlotWithSetHost('ir');
    const protocol          = makeSlotWithSetHost('p');

    const agent = await makeAgent({ interfaceRegistry, protocol });
    const result = agent.unbindFromHub();

    expect(interfaceRegistry.calls).toEqual([{ kind: null, binder: undefined }]);
    expect(protocol.calls).toEqual([{ kind: null, binder: undefined }]);
    expect(result.notified).toEqual(expect.arrayContaining(['interfaceRegistry', 'protocol']));
  });
});
