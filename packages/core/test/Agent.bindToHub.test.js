/**
 * Agent.bindToHub + Agent.unbindFromHub — unit tests (Phase 50.12).
 *
 * Strict layering: core fans out a duck-typed `setHost('hub', binder)`
 * call to each opaque slot that implements `setHost`. Slots without
 * `setHost` are silently skipped. Core never knows what the binder is.
 *
 * Covers:
 *   - bindToHub throws INVALID_ARGUMENT on null binder
 *   - calls setHost on each slot that implements it
 *   - skips slots without setHost
 *   - returns { notified: string[] } for diagnostics
 *   - emits 'hub-bound' event
 *   - per-slot setHost throw doesn't abort the fan-out; emits 'error'
 *   - unbindFromHub mirrors bindToHub semantically
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '@onderling/vault';
import { Agent }         from '../src/Agent.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';

async function makeAgent(slots = {}) {
  const identity  = await AgentIdentity.generate(new VaultMemory());
  const transport = new InternalTransport(new InternalBus(), identity.pubKey);
  return new Agent({ identity, transport, ...slots });
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

describe('Agent.bindToHub — validation', () => {
  it('throws INVALID_ARGUMENT on null binder', async () => {
    const agent = await makeAgent();
    expect(() => agent.bindToHub(null))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => agent.bindToHub(undefined))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent.bindToHub — fan-out', () => {
  it('notifies every slot that implements setHost', async () => {
    const pseudoPod     = makeSlotWithSetHost('pp');
    const agentRegistry = makeSlotWithSetHost('reg');
    const webid         = makeSlotWithSetHost('wid');

    const agent = await makeAgent({ pseudoPod, agentRegistry, webid });
    const binder = { id: 'fake-hub-binder' };

    const result = agent.bindToHub(binder);

    expect(pseudoPod.calls).toEqual([{ kind: 'hub', binder }]);
    expect(agentRegistry.calls).toEqual([{ kind: 'hub', binder }]);
    expect(webid.calls).toEqual([{ kind: 'hub', binder }]);
    expect(result.notified).toEqual(expect.arrayContaining(['pseudoPod', 'agentRegistry', 'webid']));
    expect(result.notified).toHaveLength(3);
  });

  it('skips slots without setHost', async () => {
    const pseudoPod = makeSlotWithSetHost('pp');
    const agentRegistry = { /* no setHost */ };  // plain object
    const webid = null;

    const agent = await makeAgent({ pseudoPod, agentRegistry, webid });
    const binder = { id: 'fake' };

    const result = agent.bindToHub(binder);
    expect(result.notified).toEqual(['pseudoPod']);
    expect(pseudoPod.calls).toHaveLength(1);
  });

  it('returns empty notified list when no slot has setHost', async () => {
    const agent = await makeAgent({
      pseudoPod: { read: async () => null },
      agentRegistry: { register: async () => {} },
    });
    const result = agent.bindToHub({ id: 'binder' });
    expect(result.notified).toEqual([]);
  });

  it("emits 'hub-bound' event with binder + notified", async () => {
    const pseudoPod = makeSlotWithSetHost('pp');
    const agent = await makeAgent({ pseudoPod });
    const binder = { id: 'b' };

    const events = [];
    agent.on('hub-bound', (data) => events.push(data));

    agent.bindToHub(binder);

    expect(events).toHaveLength(1);
    expect(events[0].binder).toBe(binder);
    expect(events[0].notified).toEqual(['pseudoPod']);
  });

  it("per-slot setHost throw doesn't abort fan-out; emits 'error'", async () => {
    const pseudoPod = {
      setHost() { throw Object.assign(new Error('pp boom'), { code: 'X' }); },
    };
    const agentRegistry = makeSlotWithSetHost('reg');

    const agent = await makeAgent({ pseudoPod, agentRegistry });

    const errors = [];
    agent.on('error', (err) => errors.push(err));

    const result = agent.bindToHub({ id: 'b' });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('pp boom');
    expect(errors[0].slot).toBe('pseudoPod');

    // agentRegistry still got notified despite pseudoPod throwing.
    expect(agentRegistry.calls).toHaveLength(1);
    expect(result.notified).toEqual(['agentRegistry']);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('Agent.unbindFromHub — fan-out', () => {
  it('calls setHost(null) on each slot that has it', async () => {
    const pseudoPod     = makeSlotWithSetHost('pp');
    const agentRegistry = makeSlotWithSetHost('reg');

    const agent = await makeAgent({ pseudoPod, agentRegistry });

    const result = agent.unbindFromHub();

    expect(pseudoPod.calls).toEqual([{ kind: null, binder: undefined }]);
    expect(agentRegistry.calls).toEqual([{ kind: null, binder: undefined }]);
    expect(result.notified).toEqual(expect.arrayContaining(['pseudoPod', 'agentRegistry']));
  });

  it("emits 'hub-unbound' event", async () => {
    const pseudoPod = makeSlotWithSetHost('pp');
    const agent = await makeAgent({ pseudoPod });

    const events = [];
    agent.on('hub-unbound', (data) => events.push(data));

    agent.unbindFromHub();

    expect(events).toHaveLength(1);
    expect(events[0].notified).toEqual(['pseudoPod']);
  });
});
