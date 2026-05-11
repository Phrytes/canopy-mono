/**
 * PseudoPod — standalone mode.
 *
 * Covers:
 *   - Constructor argument validation.
 *   - URI scheme enforcement (only pseudo-pod://).
 *   - read/write/delete round-trip.
 *   - write to non-local URI rejected.
 *   - list returns container contents.
 *   - subscribe fires on writes under a URI.
 *   - fetchResourceSkill is registered/invokable shape.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '../index.js';

function mkPod() {
  return createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId: 'laptop-anne',
  });
}

describe('PseudoPod — constructor validation', () => {
  it('throws on missing backend', () => {
    expect(() => createPseudoPod({ mode: 'standalone', deviceId: 'x' }))
      .toThrow(/backend/);
  });

  it('throws on bad mode', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode:    'wrong',
      deviceId: 'x',
    })).toThrow(/mode/);
  });

  it('throws on missing deviceId', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode:    'standalone',
    })).toThrow(/deviceId/);
  });

  it('replication-ring requires transport + getPeers', () => {
    expect(() => createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'replication-ring',
      deviceId: 'x',
    })).toThrow(/transport/);
    expect(() => createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'replication-ring',
      deviceId: 'x',
      transport: { publishEnvelope: async () => {} },
    })).toThrow(/getPeers/);
  });
});

describe('PseudoPod — URI scheme', () => {
  it('write rejects non-pseudo-pod URIs', async () => {
    const pod = mkPod();
    await expect(pod.write('https://anne.pod/x', { a: 1 }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEME' });
  });

  it('write rejects URIs for another device', async () => {
    const pod = mkPod();
    await expect(pod.write('pseudo-pod://other/x', { a: 1 }))
      .rejects.toMatchObject({ code: 'NOT_LOCAL' });
  });

  it('read rejects non-pseudo-pod URIs', async () => {
    const pod = mkPod();
    await expect(pod.read('https://anne.pod/x'))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEME' });
  });
});

describe('PseudoPod.standalone — round-trip', () => {
  it('writes and reads back', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/tasks/abc';
    const { etag } = await pod.write(uri, { text: 'paint' });
    expect(typeof etag).toBe('string');
    const rec = await pod.read(uri);
    expect(rec).toEqual({ uri, bytes: { text: 'paint' }, etag });
  });

  it('preserves caller-supplied etag', async () => {
    const pod = mkPod();
    const { etag } = await pod.write(
      'pseudo-pod://laptop-anne/notes/1',
      'hi',
      '"caller-v3"',
    );
    expect(etag).toBe('"caller-v3"');
  });

  it('returns null for missing reads', async () => {
    const pod = mkPod();
    expect(await pod.read('pseudo-pod://laptop-anne/nope')).toBe(null);
  });

  it('delete removes a resource', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/x';
    await pod.write(uri, 1);
    await pod.delete(uri);
    expect(await pod.read(uri)).toBe(null);
  });

  it('list returns container contents', async () => {
    const pod = mkPod();
    await pod.write('pseudo-pod://laptop-anne/tasks/a', 1);
    await pod.write('pseudo-pod://laptop-anne/tasks/b', 1);
    await pod.write('pseudo-pod://laptop-anne/notes/c', 1);
    expect(await pod.list('pseudo-pod://laptop-anne/tasks/')).toEqual([
      'pseudo-pod://laptop-anne/tasks/a',
      'pseudo-pod://laptop-anne/tasks/b',
    ]);
  });

  it('list tolerates URIs without trailing slash', async () => {
    const pod = mkPod();
    await pod.write('pseudo-pod://laptop-anne/tasks/a', 1);
    expect(await pod.list('pseudo-pod://laptop-anne/tasks')).toEqual([
      'pseudo-pod://laptop-anne/tasks/a',
    ]);
  });
});

describe('PseudoPod.standalone — subscribe', () => {
  it('fires on writes under the subscribed URI prefix', async () => {
    const pod = mkPod();
    const events = [];
    pod.subscribe('pseudo-pod://laptop-anne/tasks/', (e) => events.push(e));

    await pod.write('pseudo-pod://laptop-anne/tasks/a', 1);
    await pod.write('pseudo-pod://laptop-anne/notes/x', 1);
    await pod.write('pseudo-pod://laptop-anne/tasks/b', 1);

    expect(events.map(e => e.key)).toEqual([
      'pseudo-pod://laptop-anne/tasks/a',
      'pseudo-pod://laptop-anne/tasks/b',
    ]);
  });
});

describe('PseudoPod — fetchResourceSkill', () => {
  it('returns a skill definition shape', () => {
    const pod = mkPod();
    const skill = pod.fetchResourceSkill();
    expect(skill).toBeTruthy();
    expect(typeof skill.handler).toBe('function');
    expect(skill.id).toBe('fetch-resource');
  });

  it('reads through to the pseudo-pod', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/x';
    await pod.write(uri, { value: 42 });

    const skill = pod.fetchResourceSkill();
    const parts = await skill.handler({
      parts: [{ type: 'DataPart', data: { uri } }],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('DataPart');
    expect(parts[0].data.bytes).toEqual({ value: 42 });
    expect(typeof parts[0].data.etag).toBe('string');
  });

  it('NOT_FOUND error for missing resource via skill', async () => {
    const pod = mkPod();
    const skill = pod.fetchResourceSkill();
    await expect(skill.handler({
      parts: [{ type: 'DataPart', data: { uri: 'pseudo-pod://laptop-anne/missing' } }],
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PseudoPod — mode introspection', () => {
  it('reports the current global mode for any URI in V0', () => {
    const pod = mkPod();
    expect(pod.mode('pseudo-pod://laptop-anne/x')).toBe('standalone');
    expect(pod.currentMode).toBe('standalone');
  });

  it('flush is a no-op stub in V0', async () => {
    const pod = mkPod();
    await expect(pod.flush('pseudo-pod://laptop-anne/x')).resolves.toBeUndefined();
  });
});
