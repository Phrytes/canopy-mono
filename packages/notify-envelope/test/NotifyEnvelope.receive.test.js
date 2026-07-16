/**
 * createNotifyEnvelope — receiver side.
 *
 * Verifies that:
 *   - start() hooks transport.subscribeEnvelopes.
 *   - stop() unhooks.
 *   - Full-payload envelopes auto-writeFromPeer into the local pseudo-pod
 *     BEFORE the subscriber callback fires.
 *   - Envelope-only envelopes fire callbacks without touching the
 *     local store.
 *   - Per-kind subscribers fire only on matching envelopes.
 *   - '*' wildcard fires on every envelope.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createPodRouting } from '@onderling/pod-routing';
import { createNotifyEnvelope } from '../src/NotifyEnvelope.js';

function fakeTransport() {
  const sent = [];
  let inboxCb = null;
  return {
    sent,
    async publishEnvelope(env) { sent.push(env); },
    subscribeEnvelopes(cb) { inboxCb = cb; return () => { inboxCb = null; }; },
    isBound: () => inboxCb !== null,
    async deliver(payload, raw = {}) {
      if (inboxCb) await inboxCb(payload, raw);
    },
  };
}

function rig({ deviceId = 'd1' } = {}) {
  const pseudoPod = createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
  const podRouting = createPodRouting({ pseudoPod, deviceId });
  const transport = fakeTransport();
  const ne = createNotifyEnvelope({ transport, pseudoPod, podRouting });
  return { pseudoPod, podRouting, transport, ne };
}

describe('start / stop lifecycle', () => {
  it('start() binds, stop() unbinds', () => {
    const { transport, ne } = rig();
    expect(transport.isBound()).toBe(false);
    ne.start();
    expect(transport.isBound()).toBe(true);
    expect(ne.running).toBe(true);
    ne.stop();
    expect(transport.isBound()).toBe(false);
    expect(ne.running).toBe(false);
  });

  it('start() is idempotent', () => {
    const { ne } = rig();
    ne.start();
    ne.start();   // no second binding
    expect(ne.running).toBe(true);
    ne.stop();
  });
});

describe('receive — envelope-only', () => {
  it('fires per-kind subscriber without touching local store', async () => {
    const { ne, transport, pseudoPod } = rig();
    ne.start();
    const fired = [];
    ne.subscribe({ kind: 'task', callback: (env) => fired.push(env) });

    await transport.deliver({
      v: 1, kind: 'task',
      ref: 'https://anne.pod/sharing/tasks/x',
      etag: '"v1"',
      fromActor: 'agent://anne',
      timestamp: '2026-05-11T10:00:00Z',
    });
    expect(fired).toHaveLength(1);
    expect(fired[0].ref).toBe('https://anne.pod/sharing/tasks/x');
    expect(await pseudoPod.read('https://anne.pod/sharing/tasks/x')).toBe(null);
    ne.stop();
  });
});

describe('receive — full-payload', () => {
  it('writeFromPeer stashes payload BEFORE the callback fires', async () => {
    const { ne, transport, pseudoPod } = rig();
    ne.start();
    const seenAtCallback = [];
    ne.subscribe({
      kind: 'task',
      callback: async (env) => {
        const rec = await pseudoPod.read(env.ref);
        seenAtCallback.push(rec);
      },
    });

    await transport.deliver({
      v: 1, kind: 'task',
      ref: 'pseudo-pod://anne-device/tasks/x',
      etag: '"v-hash"',
      fromActor: 'pseudo-pod://anne-device/agent',
      payload: { text: 'paint the fence' },
      timestamp: '2026-05-11T10:00:00Z',
    });
    expect(seenAtCallback).toHaveLength(1);
    expect(seenAtCallback[0]?.bytes).toEqual({ text: 'paint the fence' });
    ne.stop();
  });
});

describe('subscribe — kind routing', () => {
  it('per-kind subscriber only fires on matching kind', async () => {
    const { ne, transport } = rig();
    ne.start();
    const tasks = [];
    const notes = [];
    ne.subscribe({ kind: 'task', callback: (e) => tasks.push(e.ref) });
    ne.subscribe({ kind: 'note', callback: (e) => notes.push(e.ref) });

    await transport.deliver({ v: 1, kind: 'task', ref: 'r/task-a' });
    await transport.deliver({ v: 1, kind: 'note', ref: 'r/note-a' });
    await transport.deliver({ v: 1, kind: 'note', ref: 'r/note-b' });

    expect(tasks).toEqual(['r/task-a']);
    expect(notes).toEqual(['r/note-a', 'r/note-b']);
    ne.stop();
  });

  it('"*" wildcard fires on every envelope', async () => {
    const { ne, transport } = rig();
    ne.start();
    const seen = [];
    ne.subscribe({ kind: '*', callback: (e) => seen.push(e.kind) });

    await transport.deliver({ v: 1, kind: 'task', ref: 'r/1' });
    await transport.deliver({ v: 1, kind: 'note', ref: 'r/2' });
    expect(seen).toEqual(['task', 'note']);
    ne.stop();
  });

  it('unsubscribe stops the callback', async () => {
    const { ne, transport } = rig();
    ne.start();
    const fired = [];
    const unsub = ne.subscribe({ kind: 'task', callback: (e) => fired.push(e.ref) });

    await transport.deliver({ v: 1, kind: 'task', ref: 'r/1' });
    unsub();
    await transport.deliver({ v: 1, kind: 'task', ref: 'r/2' });
    expect(fired).toEqual(['r/1']);
    ne.stop();
  });

  it('subscriber errors do not block siblings', async () => {
    const { ne, transport } = rig();
    ne.start();
    const good = [];
    ne.subscribe({ kind: 'task', callback: () => { throw new Error('bang'); } });
    ne.subscribe({ kind: 'task', callback: (e) => good.push(e.ref) });
    await transport.deliver({ v: 1, kind: 'task', ref: 'r/1' });
    expect(good).toEqual(['r/1']);
    ne.stop();
  });

  it('rejects callback that is not a function', () => {
    const { ne } = rig();
    expect(() => ne.subscribe({ kind: 'task', callback: 'not-a-fn' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
