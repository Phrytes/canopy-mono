/**
 * createProtocolOrchestrator — runtime semantics.
 *
 * Backed by a real in-memory pseudo-pod so persistence across
 * "restarts" exercises the actual write paths.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { defineProtocol } from '../src/defineProtocol.js';
import { createProtocolOrchestrator } from '../src/orchestrator.js';

const TOGGLE = defineProtocol({
  id:      'toggle',
  initial: 'off',
  states:  ['off', 'on', 'broken'],
  transitions: [
    { from: 'off', event: 'flip',  to: 'on',     reducer: (c) => ({ ...c, flips: (c.flips ?? 0) + 1 }) },
    { from: 'on',  event: 'flip',  to: 'off',    reducer: (c) => ({ ...c, flips: (c.flips ?? 0) + 1 }) },
    { from: 'on',  event: 'smash', to: 'broken' },
    { from: 'off',
      event: 'try',
      to:    'on',
      guard: (ctx, payload) => payload?.password === 'sesame',
    },
  ],
});

function mkPod(deviceId = 'd1') {
  return createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
}

describe('createProtocolOrchestrator — construction', () => {
  it('rejects missing pseudoPod', () => {
    expect(() => createProtocolOrchestrator({})).toThrow(/pseudoPod/);
  });

  it('rejects missing deviceId', () => {
    expect(() => createProtocolOrchestrator({ pseudoPod: mkPod() })).toThrow(/deviceId/);
  });
});

describe('start', () => {
  let orch;
  beforeEach(() => {
    orch = createProtocolOrchestrator({ pseudoPod: mkPod(), deviceId: 'd1' });
    orch.registerProtocol(TOGGLE);
  });

  it('creates an instance in the initial state', async () => {
    const inst = await orch.start('toggle', { tag: 'kitchen' });
    expect(inst.state).toBe('off');
    expect(inst.protocolId).toBe('toggle');
    expect(typeof inst.instanceId).toBe('string');
    expect(inst.context).toEqual({ tag: 'kitchen' });
    expect(inst.history).toEqual([]);
    expect(typeof inst.startedAt).toBe('string');
  });

  it('rejects unknown protocols', async () => {
    await expect(orch.start('nope')).rejects.toMatchObject({ code: 'UNKNOWN_PROTOCOL' });
  });

  it('honours validators.initial', async () => {
    const P = defineProtocol({
      id: 'guarded',
      initial: 's',
      states: ['s'],
      transitions: [],
      validators: { initial: (ctx) => typeof ctx?.required === 'string' },
    });
    orch.registerProtocol(P);
    await expect(orch.start('guarded', {})).rejects.toMatchObject({ code: 'INVALID_INITIAL_CONTEXT' });
    await expect(orch.start('guarded', { required: 'ok' })).resolves.toBeTruthy();
  });
});

describe('step', () => {
  let orch; let inst;
  beforeEach(async () => {
    orch = createProtocolOrchestrator({ pseudoPod: mkPod(), deviceId: 'd1' });
    orch.registerProtocol(TOGGLE);
    inst = await orch.start('toggle', {});
  });

  it('applies a transition + invokes the reducer', async () => {
    const next = await orch.step(inst.instanceId, 'flip');
    expect(next.state).toBe('on');
    expect(next.context.flips).toBe(1);
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toMatchObject({ event: 'flip', from: 'off', to: 'on' });
  });

  it('rejects with NO_TRANSITION on bad event', async () => {
    await expect(orch.step(inst.instanceId, 'nope'))
      .rejects.toMatchObject({ code: 'NO_TRANSITION' });
  });

  it('rejects when guard returns false', async () => {
    await expect(orch.step(inst.instanceId, 'try', { password: 'wrong' }))
      .rejects.toMatchObject({ code: 'GUARD_REJECTED' });
    // State unchanged.
    const cur = await orch.read(inst.instanceId);
    expect(cur.state).toBe('off');
  });

  it('passes guard when payload satisfies it', async () => {
    const next = await orch.step(inst.instanceId, 'try', { password: 'sesame' });
    expect(next.state).toBe('on');
  });

  it('rejects step on a non-existent instance', async () => {
    await expect(orch.step('does-not-exist', 'flip'))
      .rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('multi-step trajectory accumulates history', async () => {
    await orch.step(inst.instanceId, 'flip');                // off → on
    await orch.step(inst.instanceId, 'flip');                // on → off
    await orch.step(inst.instanceId, 'try', { password: 'sesame' });   // off → on
    await orch.step(inst.instanceId, 'smash');               // on → broken
    const cur = await orch.read(inst.instanceId);
    expect(cur.state).toBe('broken');
    expect(cur.history.map(h => h.to)).toEqual(['on', 'off', 'on', 'broken']);
    expect(cur.context.flips).toBe(2);
  });
});

describe('persistence across orchestrator restart', () => {
  it('a fresh orchestrator over the same pseudo-pod reads the same instance', async () => {
    const pseudoPod = mkPod('d1');
    const o1 = createProtocolOrchestrator({ pseudoPod, deviceId: 'd1' });
    o1.registerProtocol(TOGGLE);
    const inst = await o1.start('toggle', { tag: 'x' });
    await o1.step(inst.instanceId, 'flip');

    const o2 = createProtocolOrchestrator({ pseudoPod, deviceId: 'd1' });
    o2.registerProtocol(TOGGLE);
    const cur = await o2.read(inst.instanceId);
    expect(cur.state).toBe('on');
    expect(cur.context).toEqual({ tag: 'x', flips: 1 });
  });
});

describe('subscribe', () => {
  it('fires on start + step; respects unsubscribe', async () => {
    const orch = createProtocolOrchestrator({ pseudoPod: mkPod(), deviceId: 'd1' });
    orch.registerProtocol(TOGGLE);
    const inst = await orch.start('toggle', {});
    const events = [];
    const unsub = orch.subscribe(inst.instanceId, (e) => events.push(e.op));
    await orch.step(inst.instanceId, 'flip');
    await orch.step(inst.instanceId, 'flip');
    unsub();
    await orch.step(inst.instanceId, 'flip');
    expect(events).toEqual(['step', 'step']);
  });

  it('subscriber errors do not break siblings', async () => {
    const orch = createProtocolOrchestrator({ pseudoPod: mkPod(), deviceId: 'd1' });
    orch.registerProtocol(TOGGLE);
    const inst = await orch.start('toggle', {});
    const good = [];
    orch.subscribe(inst.instanceId, () => { throw new Error('bang'); });
    orch.subscribe(inst.instanceId, () => good.push(1));
    await orch.step(inst.instanceId, 'flip');
    expect(good).toEqual([1]);
  });
});
